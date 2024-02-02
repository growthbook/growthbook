import { DataSourceInterface } from "../../../types/datasource";
import { FactMetricInterface } from "../../../types/fact-table";
import { PostBulkImportFactsResponse } from "../../../types/openapi";
import { queueFactTableColumnsRefresh } from "../../jobs/refreshFactTableColumns";
import { getDataSourcesByOrganization } from "../../models/DataSourceModel";
import {
  createFactMetric,
  getAllFactMetricsForOrganization,
  updateFactMetric,
} from "../../models/FactMetricModel";
import {
  createFactFilter,
  createFactTable,
  updateFactTable,
  updateFactFilter,
  getFactTableMap,
} from "../../models/FactTableModel";
import { findAllProjectsByOrganization } from "../../models/ProjectModel";
import { addTags } from "../../models/TagModel";
import { createApiRequestHandler } from "../../util/handler";
import { postBulkImportFactsValidator } from "../../validators/openapi";
import {
  getCreateMetricPropsFromBody,
  validateFactMetric,
} from "../fact-metrics/postFactMetric";
import { getUpdateFactMetricPropsFromBody } from "../fact-metrics/updateFactMetric";

export const postBulkImportFacts = createApiRequestHandler(
  postBulkImportFactsValidator
)(
  async (req): Promise<PostBulkImportFactsResponse> => {
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

    const allFactMetrics = await getAllFactMetricsForOrganization(req.context);
    const factMetricMap = new Map<string, FactMetricInterface>(
      allFactMetrics.map((m) => [m.id, m])
    );

    const allDataSources = await getDataSourcesByOrganization(req.context);
    const dataSourceMap = new Map<string, DataSourceInterface>(
      allDataSources.map((s) => [s.id, s])
    );

    const tagsToAdd = new Set<string>();

    function checkFactTablePermission(factTable: { projects?: string[] }) {
      req.checkPermissions("manageFactTables", factTable.projects || []);
    }
    function checkFactMetricPermission(factMetric: { projects?: string[] }) {
      req.checkPermissions("createMetrics", factMetric.projects || []);
    }

    const projects = await findAllProjectsByOrganization(req.context);
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
        if (
          !datasource.settings?.userIdTypes?.some((t) => t.userIdType === id)
        ) {
          throw new Error(
            `User ID type ${id} not found in datasource ${datasourceId}`
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
          checkFactTablePermission(existing);
          if (data.projects) checkFactTablePermission(data);
          if (data.userIdTypes) {
            validateUserIdTypes(existing.datasource, data.userIdTypes);
          }

          // Cannot change data source
          if (data.datasource && existing.datasource !== data.datasource) {
            throw new Error(
              "Cannot change data source for existing fact table"
            );
          }

          await updateFactTable(req.context, existing, data);
          await queueFactTableColumnsRefresh(existing);
          factTableMap.set(existing.id, {
            ...existing,
            ...data,
          });
          numUpdated.factTables++;
        }
        // Create new fact table
        else {
          checkFactTablePermission(data);

          if (!dataSourceMap.has(data.datasource)) {
            throw new Error("Could not find datasource");
          }

          if (data.userIdTypes) {
            validateUserIdTypes(data.datasource, data.userIdTypes);
          }

          const newFactTable = await createFactTable(req.context, {
            columns: [],
            eventName: "",
            id: id,
            description: "",
            owner: "",
            projects: [],
            tags: [],
            ...data,
          });
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
            `Could not find fact table ${factTableId} for filter ${id}`
          );
        }
        checkFactTablePermission(factTable);

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
            data
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

        const existing = factMetricMap.get(id);
        // Update existing fact metric
        if (existing) {
          checkFactMetricPermission(existing);
          if (data.projects) checkFactMetricPermission(data);

          const changes = getUpdateFactMetricPropsFromBody(data);
          await validateFactMetric(
            { ...existing, ...changes },
            async (id) => factTableMap.get(id) || null
          );

          await updateFactMetric(req.context, existing, changes);
          factMetricMap.set(existing.id, {
            ...existing,
            ...changes,
          });
          numUpdated.factMetrics++;
        }
        // Create new fact metric
        else {
          checkFactMetricPermission(data);

          const lookupFactTable = async (id: string) =>
            factTableMap.get(id) || null;

          const createProps = await getCreateMetricPropsFromBody(
            data,
            req.organization,
            lookupFactTable
          );
          createProps.id = id;

          await validateFactMetric(createProps, lookupFactTable);

          const newFactMetric = await createFactMetric(
            req.context,
            createProps
          );
          factMetricMap.set(newFactMetric.id, newFactMetric);

          numCreated.factMetrics++;
        }
      }
    }

    // Update tags
    if (tagsToAdd.size) {
      await addTags(req.organization.id, [...tagsToAdd]);
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
  }
);
