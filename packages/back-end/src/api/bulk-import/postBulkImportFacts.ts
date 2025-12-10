import { PostBulkImportFactsResponse } from "shared/types/openapi";
import { postBulkImportFactsValidator } from "shared/validators";
import { DataSourceInterface } from "shared/types/datasource";
import {
  CreateFactTableProps,
  FactMetricInterface,
} from "shared/types/fact-table";
import { queueFactTableColumnsRefresh } from "back-end/src/jobs/refreshFactTableColumns";
import { getDataSourcesByOrganization } from "back-end/src/models/DataSourceModel";
import {
  createFactFilter,
  createFactTable,
  updateFactTable,
  updateFactFilter,
  getFactTableMap,
} from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getCreateMetricPropsFromBody } from "back-end/src/api/fact-metrics/postFactMetric";
import { getUpdateFactMetricPropsFromBody } from "back-end/src/api/fact-metrics/updateFactMetric";
import { needsColumnRefresh } from "back-end/src/api/fact-tables/updateFactTable";

export const postBulkImportFacts = createApiRequestHandler(
  postBulkImportFactsValidator,
)(async (req): Promise<PostBulkImportFactsResponse> => {
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

  const factTableMap = await getFactTableMap(req.context);

  const allFactMetrics = await req.context.models.factMetrics.getAll();
  const factMetricMap = new Map<string, FactMetricInterface>(
    allFactMetrics.map((m) => [m.id, m]),
  );

  const allDataSources = await getDataSourcesByOrganization(req.context);
  const dataSourceMap = new Map<string, DataSourceInterface>(
    allDataSources.map((s) => [s.id, s]),
  );

  const tagsToAdd = new Set<string>();

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

  // Import fact tables
  if (req.body.factTables) {
    for (const { data, id } of req.body.factTables) {
      data.tags?.forEach((t) => tagsToAdd.add(t));
      if (data.projects) validateProjectIds(data.projects);

      // This bulk endpoint is mostly used to sync from version control
      // So default these resources to only be managed by API and not the UI
      if (data.managedBy === undefined) {
        data.managedBy = "api";
      }

      const existing = factTableMap.get(id);
      // Update existing fact table
      if (existing) {
        if (!req.context.permissions.canUpdateFactTable(existing, data)) {
          req.context.permissions.throwPermissionError();
        }
        if (data.userIdTypes) {
          validateUserIdTypes(existing.datasource, data.userIdTypes);
        }

        // Cannot change data source
        if (data.datasource && existing.datasource !== data.datasource) {
          throw new Error("Cannot change data source for existing fact table");
        }

        await updateFactTable(req.context, existing, data);
        if (needsColumnRefresh(data)) {
          await queueFactTableColumnsRefresh(existing);
        }
        factTableMap.set(existing.id, {
          ...existing,
          ...data,
        });
        numUpdated.factTables++;
      }
      // Create new fact table
      else {
        const factTable: CreateFactTableProps = {
          eventName: "",
          id: id,
          description: "",
          owner: "",
          projects: [],
          tags: [],
          ...data,
        };

        if (!req.context.permissions.canCreateFactTable(factTable)) {
          req.context.permissions.throwPermissionError();
        }

        if (!dataSourceMap.has(factTable.datasource)) {
          throw new Error("Could not find datasource");
        }

        if (factTable.userIdTypes) {
          validateUserIdTypes(factTable.datasource, factTable.userIdTypes);
        }

        const newFactTable = await createFactTable(req.context, factTable);
        await queueFactTableColumnsRefresh(newFactTable);
        factTableMap.set(newFactTable.id, newFactTable);
        numCreated.factTables++;
      }
    }
  }
  // Import filters
  if (req.body.factTableFilters) {
    for (const { factTableId, data, id } of req.body.factTableFilters) {
      const factTable = factTableMap.get(factTableId);
      if (!factTable) {
        throw new Error(
          `Could not find fact table ${factTableId} for filter ${id}`,
        );
      }
      if (!req.context.permissions.canCreateAndUpdateFactFilter(factTable)) {
        req.context.permissions.throwPermissionError();
      }

      // This bulk endpoint is mostly used to sync from version control
      // So default these resources to only be managed by API and not the UI
      if (factTable.managedBy === "api" && data.managedBy === undefined) {
        data.managedBy = "api";
      }

      const existingFactFilter = factTable.filters.find((f) => f.id === id);
      // Update existing filter
      if (existingFactFilter) {
        await updateFactFilter(
          req.context,
          factTable,
          existingFactFilter.id,
          data,
        );
        Object.assign(existingFactFilter, data);
        numUpdated.factTableFilters++;
      }
      // Create new filter
      else {
        const newFilter = await createFactFilter(factTable, {
          description: "",
          ...data,
          id: id,
        });
        factTable.filters.push(newFilter);
        numCreated.factTableFilters++;
      }
    }
  }
  // Fact metrics
  if (req.body.factMetrics) {
    for (const { id: origId, data } of req.body.factMetrics) {
      data.tags?.forEach((t) => tagsToAdd.add(t));
      if (data.projects) validateProjectIds(data.projects);

      const id = origId.match(/^fact__/) ? origId : `fact__${origId}`;

      // This bulk endpoint is mostly used to sync from version control
      // So default these resources to only be managed by API and not the UI
      if (data.managedBy === undefined) {
        data.managedBy = "api";
      }

      const lookupFactTable = async (id: string) =>
        factTableMap.get(id) || null;

      const existing = factMetricMap.get(id);
      // Update existing fact metric
      if (existing) {
        const changes = await getUpdateFactMetricPropsFromBody(
          data,
          existing,
          lookupFactTable,
        );

        const newFactMetric = await req.context.models.factMetrics.update(
          existing,
          changes,
        );
        factMetricMap.set(existing.id, newFactMetric);

        numUpdated.factMetrics++;
      }
      // Create new fact metric
      else {
        const createProps = await getCreateMetricPropsFromBody(
          data,
          req.organization,
          lookupFactTable,
        );
        createProps.id = id;

        const newFactMetric =
          await req.context.models.factMetrics.create(createProps);
        factMetricMap.set(newFactMetric.id, newFactMetric);

        numCreated.factMetrics++;
      }
    }
  }

  // Update tags
  if (tagsToAdd.size) {
    await req.context.registerTags([...tagsToAdd]);
  }

  return {
    success: true,
    factTablesAdded: numCreated.factTables,
    factTablesUpdated: numUpdated.factTables,
    factTableFiltersAdded: numCreated.factTableFilters,
    factTableFiltersUpdated: numUpdated.factTableFilters,
    factMetricsAdded: numCreated.factMetrics,
    factMetricsUpdated: numUpdated.factMetrics,
  };
});
