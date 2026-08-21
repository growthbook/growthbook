import { PermissionError } from "shared/util";
import {
  BulkImportError,
  postBulkImportFactsValidator,
} from "shared/validators";
import { DataSourceInterface } from "shared/types/datasource";
import {
  AggregatedFactTableSettings,
  CreateFactTableProps,
  FactMetricInterface,
} from "shared/types/fact-table";
import { queueFactTableColumnsRefresh } from "back-end/src/jobs/refreshFactTableColumns";
import { getDataSourcesByOrganization } from "back-end/src/models/DataSourceModel";
import {
  createFactFilter,
  createFactTable,
  createPropsToInterface,
  mergeUpsertColumns,
  updateFactTable,
  updateFactFilter,
  upsertColumns,
  getFactTableMap,
} from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getCreateMetricPropsFromBody } from "back-end/src/api/fact-metrics/postFactMetric";
import { getUpdateFactMetricPropsFromBody } from "back-end/src/api/fact-metrics/updateFactMetric";
import { needsColumnRefresh } from "back-end/src/api/fact-tables/updateFactTable";
import {
  columnsHaveAutoSlices,
  columnsNeedDetection,
  validateAggregatedFactTableSettings,
  validateVirtualColumnProps,
} from "back-end/src/util/factTable";
import { resolveOwnerToUserId } from "back-end/src/services/owner";
import { BulkImportPartialFailureError } from "back-end/src/util/errors";
import { FactMetricModel } from "back-end/src/models/FactMetricModel";

export const postBulkImportFacts = createApiRequestHandler(
  postBulkImportFactsValidator,
)(async (req) => {
  const dryRun = req.body.dryRun === true;
  const defaultManagedBy = req.body.defaultManagedBy ?? "api";

  const numCreated = {
    factTables: 0,
    factTableFilters: 0,
    factMetrics: 0,
  };
  const numUpdated = {
    factTables: 0,
    factTableFilters: 0,
    factMetrics: 0,
  };
  const errors: BulkImportError[] = [];
  const tagsToAdd = new Set<string>();

  const writeCounts = () => ({
    factTablesAdded: numCreated.factTables,
    factTablesUpdated: numUpdated.factTables,
    factTableFiltersAdded: numCreated.factTableFilters,
    factTableFiltersUpdated: numUpdated.factTableFilters,
    factMetricsAdded: numCreated.factMetrics,
    factMetricsUpdated: numUpdated.factMetrics,
  });

  const registerTagsIfNeeded = async () => {
    if (
      !dryRun &&
      tagsToAdd.size &&
      Object.values(writeCounts()).some((n) => n > 0)
    ) {
      await req.context.registerTags([...tagsToAdd]);
    }
  };

  const onItemError = async (
    resourceType: BulkImportError["resourceType"],
    id: string,
    err: unknown,
  ) => {
    if (err instanceof PermissionError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    errors.push({
      resourceType,
      id,
      message,
    });
    if (!dryRun) {
      await registerTagsIfNeeded();
      throw new BulkImportPartialFailureError(message, writeCounts(), errors);
    }
  };

  const factTableMap = await getFactTableMap(req.context);

  const allFactMetrics = await req.context.models.factMetrics.getAll();
  const factMetricMap = new Map<string, FactMetricInterface>(
    allFactMetrics.map((m) => [m.id, m]),
  );

  const allDataSources = await getDataSourcesByOrganization(req.context);
  const dataSourceMap = new Map<string, DataSourceInterface>(
    allDataSources.map((s) => [s.id, s]),
  );

  const projects = await req.context.models.projects.getAll();
  const projectIds = new Set(projects.map((p) => p.id));
  function validateProjectIds(ids: string[]) {
    for (const id of ids) {
      if (!projectIds.has(id)) {
        throw new Error(`Project ${id} not found`);
      }
    }
  }

  function validateUserIdTypes(datasourceId: string, ids: string[]) {
    const datasource = dataSourceMap.get(datasourceId);
    if (!datasource) return;

    for (const id of ids) {
      if (!datasource.settings?.userIdTypes?.some((t) => t.userIdType === id)) {
        throw new Error(
          `User ID type ${id} not found in datasource ${datasourceId}`,
        );
      }
    }
  }

  function requireOfficialResourcesPlan(
    managedBy: string,
    kind: "fact tables" | "fact metrics",
  ) {
    if (
      managedBy === "admin" &&
      !req.context.hasPremiumFeature("manage-official-resources")
    ) {
      throw new Error(
        `Your organization's plan does not support creating official ${kind}.`,
      );
    }
  }

  function validateAggregatedSettings(
    settings: AggregatedFactTableSettings,
    userIdTypes: string[],
    datasourceId: string,
  ) {
    if (!req.context.hasPremiumFeature("pipeline-mode")) {
      throw new Error(
        "Maintaining shared daily aggregated tables requires the data pipeline feature.",
      );
    }
    const datasource = dataSourceMap.get(datasourceId);
    if (!datasource) {
      throw new Error("Could not find datasource");
    }
    if (!req.context.permissions.canUpdateDataSourceSettings(datasource)) {
      req.context.permissions.throwPermissionError();
    }
    validateAggregatedFactTableSettings(settings, userIdTypes);
  }

  // Import fact tables
  if (req.body.factTables) {
    for (const { data, id } of req.body.factTables) {
      try {
        data.tags?.forEach((t) => tagsToAdd.add(t));
        if (data.projects) validateProjectIds(data.projects);

        const managedBy =
          data.managedBy !== undefined ? data.managedBy : defaultManagedBy;

        // Bulk-import is not transactional, so gate slices before any write.
        if (
          columnsHaveAutoSlices(data.columns) &&
          !req.context.hasPremiumFeature("metric-slices")
        ) {
          throw new Error("Metric slices require an enterprise license");
        }

        const existing = factTableMap.get(id);

        if (data.aggregatedFactTableSettings) {
          validateAggregatedSettings(
            data.aggregatedFactTableSettings,
            data.userIdTypes ?? existing?.userIdTypes ?? [],
            existing?.datasource ?? data.datasource,
          );
        }

        // Enforce virtual-column rules on any incoming columns. Bulk import can
        // create and preserve virtual (computed) columns — used to sync them
        // from version control — but must not create an invalid one or flip an
        // existing column's origin (a SQL-detected column becoming virtual or
        // vice versa).
        if (data.columns) {
          for (const col of data.columns) {
            const existingCol = existing?.columns.find(
              (c) => c.column === col.column,
            );
            if (
              existingCol &&
              Boolean(col.isVirtual) !== Boolean(existingCol.isVirtual)
            ) {
              throw new Error(
                `Cannot change whether column "${col.column}" is a virtual column`,
              );
            }
            if (col.isVirtual) {
              validateVirtualColumnProps(col);
              // A virtual column carries raw SQL, so importing one into an
              // existing fact table needs the same gate as the dedicated
              // virtual-column endpoints.
              if (
                existing &&
                !req.context.permissions.canManageFactTableVirtualColumn(
                  existing,
                )
              ) {
                req.context.permissions.throwPermissionError();
              }
            }
          }
        }

        // Update existing fact table
        if (existing) {
          const updateData = { ...data, managedBy };
          if (
            !req.context.permissions.canUpdateFactTable(existing, updateData)
          ) {
            req.context.permissions.throwPermissionError();
          }
          if (updateData.userIdTypes) {
            validateUserIdTypes(existing.datasource, updateData.userIdTypes);
          }

          // Cannot change data source
          if (
            updateData.datasource &&
            existing.datasource !== updateData.datasource
          ) {
            throw new Error(
              "Cannot change data source for existing fact table",
            );
          }

          if (updateData.owner !== undefined) {
            updateData.owner =
              (await resolveOwnerToUserId(updateData.owner, req.context)) ?? "";
          }

          const nextColumns = data.columns
            ? mergeUpsertColumns(existing.columns, data.columns).columns
            : existing.columns;

          let counted = false;
          if (!dryRun && updateData.columns) {
            await upsertColumns({
              context: req.context,
              factTable: existing,
              columns: updateData.columns,
            });
            delete updateData.columns;
            numUpdated.factTables++;
            counted = true;
          }

          const willRefresh =
            needsColumnRefresh(existing, updateData) ||
            columnsNeedDetection(nextColumns);
          if (!dryRun) {
            await updateFactTable(
              req.context,
              existing,
              willRefresh
                ? { ...updateData, columnRefreshPending: true }
                : updateData,
            );
          }
          factTableMap.set(existing.id, {
            ...existing,
            ...updateData,
            columns: nextColumns,
            columnRefreshPending: willRefresh
              ? true
              : existing.columnRefreshPending,
          });
          if (!counted) numUpdated.factTables++;
          if (!dryRun && willRefresh) {
            await queueFactTableColumnsRefresh(existing);
          }
        }
        // Create new fact table
        else {
          const newOwner =
            (await resolveOwnerToUserId(data.owner, req.context)) ?? "";
          const factTable: CreateFactTableProps = {
            eventName: "",
            id: id,
            description: "",
            projects: [],
            tags: [],
            ...data,
            managedBy,
            owner: newOwner,
          };

          requireOfficialResourcesPlan(managedBy, "fact tables");
          if (!req.context.permissions.canCreateFactTable(factTable)) {
            req.context.permissions.throwPermissionError();
          }

          if (!dataSourceMap.has(factTable.datasource)) {
            throw new Error("Could not find datasource");
          }

          if (factTable.userIdTypes) {
            validateUserIdTypes(factTable.datasource, factTable.userIdTypes);
          }

          factTable.columnRefreshPending =
            !factTable.columns?.length ||
            columnsNeedDetection(factTable.columns);

          if (!dryRun) {
            const newFactTable = await createFactTable(req.context, factTable);
            factTableMap.set(newFactTable.id, newFactTable);
            numCreated.factTables++;
            await queueFactTableColumnsRefresh(newFactTable);
          } else {
            factTableMap.set(
              id,
              createPropsToInterface(req.context, factTable),
            );
            numCreated.factTables++;
          }
        }
      } catch (e) {
        await onItemError("factTable", id, e);
      }
    }
  }
  // Import filters
  if (req.body.factTableFilters) {
    for (const { factTableId, data, id } of req.body.factTableFilters) {
      try {
        const factTable = factTableMap.get(factTableId);
        if (!factTable) {
          throw new Error(
            `Could not find fact table ${factTableId} for filter ${id}`,
          );
        }
        if (!req.context.permissions.canCreateAndUpdateFactFilter(factTable)) {
          req.context.permissions.throwPermissionError();
        }

        const filterPayload = {
          ...data,
          ...(data.managedBy === undefined && factTable.managedBy === "api"
            ? { managedBy: "api" as const }
            : {}),
        };

        if (!id.match(/^[-a-zA-Z0-9_]+$/)) {
          throw new Error(
            "Fact table filter ids must contain only letters, numbers, underscores, and dashes",
          );
        }

        const existingFactFilter = factTable.filters.find((f) => f.id === id);
        // Update existing filter
        if (existingFactFilter) {
          if (!dryRun) {
            await updateFactFilter(
              req.context,
              factTable,
              existingFactFilter.id,
              filterPayload,
            );
          }
          Object.assign(existingFactFilter, filterPayload);
          numUpdated.factTableFilters++;
        }
        // Create new filter
        else {
          if (!factTable.managedBy && filterPayload.managedBy) {
            throw new Error(
              "Cannot create a filter managed by API unless the Fact Table is also managed by API",
            );
          }
          if (!dryRun) {
            const newFilter = await createFactFilter(factTable, {
              description: "",
              ...filterPayload,
              id: id,
            });
            factTable.filters.push(newFilter);
          } else {
            factTable.filters.push({
              id,
              description: "",
              ...filterPayload,
              dateCreated: new Date(),
              dateUpdated: new Date(),
            });
          }
          numCreated.factTableFilters++;
        }
      } catch (e) {
        await onItemError("factTableFilter", id, e);
      }
    }
  }
  // Fact metrics
  if (req.body.factMetrics) {
    for (const { id: origId, data } of req.body.factMetrics) {
      const id = origId.match(/^fact__/) ? origId : `fact__${origId}`;
      try {
        data.tags?.forEach((t) => tagsToAdd.add(t));
        if (data.projects) validateProjectIds(data.projects);

        const managedBy =
          data.managedBy !== undefined ? data.managedBy : defaultManagedBy;

        if (
          data.metricAutoSlices &&
          data.metricAutoSlices.length > 0 &&
          !req.context.hasPremiumFeature("metric-slices")
        ) {
          throw new Error("Metric slices require an enterprise license");
        }

        const lookupFactTable = async (factTableId: string) =>
          factTableMap.get(factTableId) || null;

        const metricData = {
          ...data,
          managedBy,
        };

        if (!id.match(/^[-a-zA-Z0-9_]+$/)) {
          throw new Error(
            "Fact metric ids must contain only letters, numbers, underscores, and dashes",
          );
        }

        const existing = factMetricMap.get(id);
        // Update existing fact metric
        if (existing) {
          const changes = await getUpdateFactMetricPropsFromBody(
            metricData,
            existing,
            lookupFactTable,
          );

          if (!req.context.permissions.canUpdateFactMetric(existing, changes)) {
            req.context.permissions.throwPermissionError();
          }

          if (dryRun) {
            await FactMetricModel.validateFactMetric(
              { ...existing, ...changes } as FactMetricInterface,
              existing,
              factTableMap,
              req.context,
            );
          } else {
            const newFactMetric = await req.context.models.factMetrics.update(
              existing,
              changes,
            );
            factMetricMap.set(existing.id, newFactMetric);
          }
          numUpdated.factMetrics++;
        }
        // Create new fact metric
        else {
          requireOfficialResourcesPlan(managedBy, "fact metrics");
          const createProps = await getCreateMetricPropsFromBody(
            metricData,
            req.organization,
            lookupFactTable,
          );
          createProps.id = id;

          if (!req.context.permissions.canCreateFactMetric(createProps)) {
            req.context.permissions.throwPermissionError();
          }

          if (dryRun) {
            await FactMetricModel.validateFactMetric(
              {
                ...createProps,
                id,
                organization: req.organization.id,
                dateCreated: new Date(),
                dateUpdated: new Date(),
              } as FactMetricInterface,
              null,
              factTableMap,
              req.context,
            );
          } else {
            const newFactMetric =
              await req.context.models.factMetrics.create(createProps);
            factMetricMap.set(newFactMetric.id, newFactMetric);
          }
          numCreated.factMetrics++;
        }
      } catch (e) {
        await onItemError("factMetric", id, e);
      }
    }
  }

  await registerTagsIfNeeded();

  return {
    success: errors.length === 0,
    dryRun,
    ...writeCounts(),
    errors,
  };
});
