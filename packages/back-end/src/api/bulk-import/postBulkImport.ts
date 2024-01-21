import { DataSourceInterface } from "../../../types/datasource";
import {
  CreateFactMetricProps,
  FactMetricInterface,
  UpdateFactMetricProps,
} from "../../../types/fact-table";
import { PostBulkImportResponse } from "../../../types/openapi";
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
import { addTags } from "../../models/TagModel";
import { createApiRequestHandler } from "../../util/handler";
import { postBulkImportValidator } from "../../validators/openapi";

export const postFactMetric = createApiRequestHandler(postBulkImportValidator)(
  async (req): Promise<PostBulkImportResponse> => {
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

    const factTableMap = await getFactTableMap(req.organization.id);

    const allFactMetrics = await getAllFactMetricsForOrganization(
      req.organization.id
    );
    const factMetricMap = new Map<string, FactMetricInterface>(
      allFactMetrics.map((m) => [m.id, m])
    );

    const allDataSources = await getDataSourcesByOrganization(
      req.organization.id
    );
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

    function validateFactMetric(
      data: Pick<
        FactMetricInterface,
        "numerator" | "denominator" | "metricType"
      >
    ) {
      const numeratorFactTable = factTableMap.get(data.numerator.factTableId);
      if (!numeratorFactTable) {
        throw new Error("Could not find numerator fact table");
      }

      if (data.metricType === "ratio") {
        if (!data.denominator) {
          throw new Error("Denominator required for ratio metric");
        }
        if (data.denominator.factTableId !== data.numerator.factTableId) {
          const denominatorFactTable = factTableMap.get(
            data.denominator.factTableId
          );
          if (!denominatorFactTable) {
            throw new Error("Could not find denominator fact table");
          }
        }
      } else if (data.denominator) {
        throw new Error("Denominator not allowed for non-ratio metric");
      }
    }

    // Import fact tables
    if (req.body.factTables) {
      for (const { data, id } of req.body.factTables) {
        data.tags?.forEach((t) => tagsToAdd.add(t));

        const existing = factTableMap.get(id);
        // Update existing fact table
        if (existing) {
          checkFactTablePermission(existing);
          if (data.projects) checkFactTablePermission(data);

          // Cannot change data source
          if (data.datasource && existing.datasource !== data.datasource) {
            throw new Error(
              "Cannot change data source for existing fact table"
            );
          }

          await updateFactTable(existing, data, req.eventAudit);
          numUpdated.factTables++;
        }
        // Create new fact table
        else {
          checkFactTablePermission(data);

          if (!dataSourceMap.has(data.datasource)) {
            throw new Error("Could not find datasource");
          }

          const newFactTable = await createFactTable(req.organization.id, {
            columns: [],
            eventName: "",
            id: id,
            managedBy: "",
            description: "",
            owner: "",
            projects: [],
            tags: [],
            ...data,
          });
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

        const existingFactFilter = factTable.filters.find((f) => f.id === id);
        // Update existing filter
        if (existingFactFilter) {
          await updateFactFilter(
            factTable,
            existingFactFilter.id,
            data,
            req.eventAudit
          );
          numUpdated.factTableFilters++;
        }
        // Create new filter
        else {
          await createFactFilter(factTable, {
            description: "",
            managedBy: "",
            ...data,
            id: id,
          });
          numCreated.factTableFilters++;
        }
      }
    }
    // Fact metrics
    if (req.body.factMetrics) {
      for (const { id: origId, data } of req.body.factMetrics) {
        data.tags?.forEach((t) => tagsToAdd.add(t));

        const id = origId.match(/^fact__/) ? origId : `fact__${origId}`;

        const existing = factMetricMap.get(id);
        // Update existing fact metric
        if (existing) {
          checkFactMetricPermission(existing);
          if (data.projects) checkFactMetricPermission(data);

          // Cannot change datasource
          if (data.datasource && data.datasource !== existing.datasource) {
            throw new Error(
              "Cannot change datasource for existing fact metric"
            );
          }

          const changes: UpdateFactMetricProps = {
            ...data,
            capping: data.capping === "none" ? "" : undefined,
          };

          validateFactMetric({
            ...existing,
            ...changes,
          });
          await updateFactMetric(existing, changes, req.eventAudit);
          numUpdated.factMetrics++;
        }
        // Create new fact metric
        else {
          checkFactMetricPermission(data);

          if (!dataSourceMap.has(data.datasource)) {
            throw new Error("Could not find datasource");
          }

          const createProps: CreateFactMetricProps = {
            loseRisk: 0,
            winRisk: 0,
            maxPercentChange: 0,
            minPercentChange: 0,
            minSampleSize: 0,
            description: "",
            owner: "",
            projects: [],
            tags: [],
            inverse: false,
            capValue: 0,
            regressionAdjustmentOverride: false,
            regressionAdjustmentDays: 0,
            regressionAdjustmentEnabled: false,
            conversionDelayHours: 0,
            conversionWindowValue: 0,
            conversionWindowUnit: "hours",
            hasConversionWindow: false,
            ...data,
            id: id,
            capping: (data.capping === "none" ? "" : data.capping) || "",
            denominator: data.denominator || null,
          };
          validateFactMetric(createProps);

          const newFactMetric = await createFactMetric(
            req.organization.id,
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
    };
  }
);
