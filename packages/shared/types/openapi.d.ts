/* eslint-disable */
/**
* This file was auto-generated. DO NOT MODIFY DIRECTLY
* Instead, modify the source OpenAPI schema in back-end/src/api/openapi
* and run `yarn generate-api-types` to re-generate this file.
*/

export interface paths {
  "/product-analytics/metric-exploration": {
    /** Create a Metric based visualization */
    post: operations["postMetricExploration"];
  };
  "/product-analytics/fact-table-exploration": {
    /** Run a Fact Table based visualization */
    post: operations["postFactTableExploration"];
  };
  "/product-analytics/data-source-exploration": {
    /** Create a Data Source based visualization */
    post: operations["postDataSourceExploration"];
  };
  "/custom-fields": {
    /** Get all custom fields */
    get: operations["listCustomFields"];
    /** Create a single customField */
    post: operations["createCustomField"];
  };
  "/custom-fields/{id}": {
    /** Get a single customField */
    get: operations["getCustomField"];
    /** Update a single customField */
    put: operations["updateCustomField"];
    /** Delete a single customField */
    delete: operations["deleteCustomField"];
  };
  "/dashboards/{id}": {
    /** Get a single dashboard */
    get: operations["getDashboard"];
    /** Update a single dashboard */
    put: operations["updateDashboard"];
    /** Delete a single dashboard */
    delete: operations["deleteDashboard"];
  };
  "/dashboards": {
    /** Get all dashboards */
    get: operations["listDashboards"];
    /** Create a single dashboard */
    post: operations["createDashboard"];
  };
  "/dashboards/by-experiment/{experimentId}": {
    /** Get all dashboards for an experiment */
    get: operations["getDashboardsForExperiment"];
  };
  "/experiment-templates/{id}": {
    /** Get a single experimentTemplate */
    get: operations["getExperimentTemplate"];
    /** Update a single experimentTemplate */
    put: operations["updateExperimentTemplate"];
    /** Delete a single experimentTemplate */
    delete: operations["deleteExperimentTemplate"];
  };
  "/experiment-templates": {
    /** Get all experimentTemplates */
    get: operations["listExperimentTemplates"];
    /** Create a single experimentTemplate */
    post: operations["createExperimentTemplate"];
  };
  "/experiment-templates/bulk-import": {
    /** Bulk create or update experiment templates */
    post: operations["bulkImportExperimentTemplates"];
  };
  "/metric-groups/{id}": {
    /** Get a single metricGroup */
    get: operations["getMetricGroup"];
    /** Update a single metricGroup */
    put: operations["updateMetricGroup"];
    /** Delete a single metricGroup */
    delete: operations["deleteMetricGroup"];
  };
  "/metric-groups": {
    /** Get all metricGroups */
    get: operations["listMetricGroups"];
    /** Create a single metricGroup */
    post: operations["createMetricGroup"];
  };
  "/ramp-schedule-templates/{id}": {
    /** Get a single rampScheduleTemplate */
    get: operations["getRampScheduleTemplate"];
    /** Update a single rampScheduleTemplate */
    put: operations["updateRampScheduleTemplate"];
    /** Delete a single rampScheduleTemplate */
    delete: operations["deleteRampScheduleTemplate"];
  };
  "/ramp-schedule-templates": {
    /** Get all rampScheduleTemplates */
    get: operations["listRampScheduleTemplates"];
    /** Create a single rampScheduleTemplate */
    post: operations["createRampScheduleTemplate"];
  };
  "/ramp-schedules/{id}": {
    /** Get a single rampSchedule */
    get: operations["getRampSchedule"];
    /** Update a single rampSchedule */
    put: operations["updateRampSchedule"];
    /** Delete a single rampSchedule */
    delete: operations["deleteRampSchedule"];
  };
  "/ramp-schedules": {
    /** Get all rampSchedules */
    get: operations["listRampSchedules"];
    /** Create a single rampSchedule */
    post: operations["createRampSchedule"];
  };
  "/teams/{id}": {
    /** Get a single team */
    get: operations["getTeam"];
    /** Update a single team */
    put: operations["updateTeam"];
  };
  "/teams": {
    /** Get all teams */
    get: operations["listTeams"];
    /** Create a single team */
    post: operations["createTeam"];
  };
  "/teams/{teamId}/members": {
    /** Add members to team */
    post: operations["addTeamMembers"];
    /** Remove members from team */
    delete: operations["removeTeamMember"];
  };
  "/teams/{teamId}": {
    /** Delete a single team */
    delete: operations["deleteTeam"];
  };
}

export type webhooks = Record<string, never>;

export interface components {
  schemas: {
    AnalyticsExploration: {
      id: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      datasource: string;
      /** @enum {string} */
      status: "running" | "success" | "error";
      dateStart: string;
      dateEnd: string;
      error?: string | null;
      result: {
        rows: ({
            dimensions: (string | null)[];
            values: ({
                metricId: string;
                numerator: number | null;
                denominator: number | null;
              })[];
          })[];
      };
      config: ({
        /** @description ID of the datasource to query */
        datasource: string;
        dimensions: (({
            /** @constant */
            dimensionType: "date";
            column: string | null;
            /** @enum {string} */
            dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
          }) | ({
            /** @constant */
            dimensionType: "dynamic";
            column: string | null;
            maxValues: number;
          }) | {
            /** @constant */
            dimensionType: "static";
            column: string;
            values: (string)[];
          } | ({
            /** @constant */
            dimensionType: "slice";
            slices: ({
                name: string;
                filters: ({
                    /** @enum {string} */
                    operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                    column?: string;
                    values?: (string)[];
                  })[];
              })[];
          }))[];
        /** @enum {string} */
        chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
        dateRange: {
          /** @enum {string} */
          predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
          lookbackValue?: number | null;
          lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
          startDate?: string | null;
          endDate?: string | null;
        };
        /** @constant */
        type: "metric";
        dataset: {
          /** @constant */
          type: "metric";
          values: ({
              name: string;
              rowFilters: ({
                  /** @enum {string} */
                  operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                  column?: string;
                  values?: (string)[];
                })[];
              /** @constant */
              type: "metric";
              metricId: string;
              unit: string | null;
              denominatorUnit: string | null;
            })[];
        };
      }) | ({
        /** @description ID of the datasource to query */
        datasource: string;
        dimensions: (({
            /** @constant */
            dimensionType: "date";
            column: string | null;
            /** @enum {string} */
            dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
          }) | ({
            /** @constant */
            dimensionType: "dynamic";
            column: string | null;
            maxValues: number;
          }) | {
            /** @constant */
            dimensionType: "static";
            column: string;
            values: (string)[];
          } | ({
            /** @constant */
            dimensionType: "slice";
            slices: ({
                name: string;
                filters: ({
                    /** @enum {string} */
                    operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                    column?: string;
                    values?: (string)[];
                  })[];
              })[];
          }))[];
        /** @enum {string} */
        chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
        dateRange: {
          /** @enum {string} */
          predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
          lookbackValue?: number | null;
          lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
          startDate?: string | null;
          endDate?: string | null;
        };
        /** @constant */
        type: "fact_table";
        dataset: {
          /** @constant */
          type: "fact_table";
          factTableId: string | null;
          values: ({
              name: string;
              rowFilters: ({
                  /** @enum {string} */
                  operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                  column?: string;
                  values?: (string)[];
                })[];
              /** @constant */
              type: "fact_table";
              /** @enum {string} */
              valueType: "unit_count" | "count" | "sum";
              valueColumn: string | null;
              unit: string | null;
            })[];
        };
      }) | ({
        /** @description ID of the datasource to query */
        datasource: string;
        dimensions: (({
            /** @constant */
            dimensionType: "date";
            column: string | null;
            /** @enum {string} */
            dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
          }) | ({
            /** @constant */
            dimensionType: "dynamic";
            column: string | null;
            maxValues: number;
          }) | {
            /** @constant */
            dimensionType: "static";
            column: string;
            values: (string)[];
          } | ({
            /** @constant */
            dimensionType: "slice";
            slices: ({
                name: string;
                filters: ({
                    /** @enum {string} */
                    operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                    column?: string;
                    values?: (string)[];
                  })[];
              })[];
          }))[];
        /** @enum {string} */
        chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
        dateRange: {
          /** @enum {string} */
          predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
          lookbackValue?: number | null;
          lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
          startDate?: string | null;
          endDate?: string | null;
        };
        /** @constant */
        type: "data_source";
        dataset: {
          /** @constant */
          type: "data_source";
          table: string;
          path: string;
          timestampColumn: string;
          columnTypes: {
            [key: string]: ("string" | "number" | "date" | "boolean" | "other") | undefined;
          };
          values: ({
              name: string;
              rowFilters: ({
                  /** @enum {string} */
                  operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                  column?: string;
                  values?: (string)[];
                })[];
              /** @constant */
              type: "data_source";
              /** @enum {string} */
              valueType: "unit_count" | "count" | "sum";
              valueColumn: string | null;
              unit: string | null;
            })[];
        };
      });
    };
    CustomField: {
      id: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      name: string;
      description?: string;
      placeholder?: string;
      defaultValue?: string | number | boolean | string | string | (string)[] | (number)[] | (boolean)[] | (string)[] | (string)[];
      /** @enum {string} */
      type: "text" | "textarea" | "markdown" | "enum" | "multiselect" | "url" | "number" | "boolean" | "date" | "datetime";
      values?: string;
      required: boolean;
      creator?: string;
      projects?: (string)[];
      sections: ("feature" | "experiment")[];
      active?: boolean;
    };
    Dashboard: {
      id: string;
      uid: string;
      organization: string;
      experimentId?: string;
      isDefault: boolean;
      isDeleted: boolean;
      userId: string;
      /** @enum {string} */
      editLevel: "published" | "private";
      /** @enum {string} */
      shareLevel: "published" | "private";
      enableAutoUpdates: boolean;
      updateSchedule?: {
        /** @constant */
        type: "stale";
        hours: number;
      } | {
        /** @constant */
        type: "cron";
        cron: string;
      };
      title: string;
      projects?: (string)[];
      /** Format: date-time */
      nextUpdate?: string;
      /** Format: date-time */
      lastUpdated?: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      blocks: (({
          organization: string;
          id: string;
          uid: string;
          /** @constant */
          type: "metric-explorer";
          title: string;
          description: string;
          snapshotId?: string;
          factMetricId: string;
          /** @enum {string} */
          visualizationType: "histogram" | "bigNumber" | "timeseries";
          /** @enum {string} */
          valueType: "avg" | "sum";
          metricAnalysisId: string;
          analysisSettings: {
            userIdType: string;
            lookbackDays: number;
            /** @enum {string} */
            populationType: "metric" | "factTable" | "exposureQuery" | "population" | "segment";
            populationId: string | null;
            additionalNumeratorFilters?: (string)[];
            additionalDenominatorFilters?: (string)[];
            startDate: string;
            endDate: string;
          };
        }) | {
          organization: string;
          id: string;
          uid: string;
          /** @constant */
          type: "markdown";
          title: string;
          description: string;
          snapshotId?: string;
          content: string;
        } | {
          organization: string;
          id: string;
          uid: string;
          /** @constant */
          type: "experiment-metadata";
          title: string;
          description: string;
          snapshotId?: string;
          experimentId: string;
          showDescription: boolean;
          showHypothesis: boolean;
          showVariationImages: boolean;
          variationIds?: (string)[];
        } | ({
          organization: string;
          id: string;
          uid: string;
          /** @constant */
          type: "experiment-metric";
          title: string;
          description: string;
          snapshotId: string;
          experimentId: string;
          metricIds: (string)[];
          variationIds: (string)[];
          baselineRow: number;
          /** @enum {string} */
          differenceType: "absolute" | "relative" | "scaled";
          columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
          sliceTagsFilter: (string)[];
          metricTagFilter: (string)[];
          sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
          sortDirection: ("asc" | "desc") | null;
        }) | ({
          organization: string;
          id: string;
          uid: string;
          /** @constant */
          type: "experiment-dimension";
          title: string;
          description: string;
          snapshotId: string;
          experimentId: string;
          dimensionId: string;
          dimensionValues: (string)[];
          metricIds: (string)[];
          variationIds: (string)[];
          baselineRow: number;
          /** @enum {string} */
          differenceType: "absolute" | "relative" | "scaled";
          columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
          metricTagFilter: (string)[];
          sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
          sortDirection: ("asc" | "desc") | null;
        }) | ({
          organization: string;
          id: string;
          uid: string;
          /** @constant */
          type: "experiment-time-series";
          title: string;
          description: string;
          snapshotId: string;
          experimentId: string;
          metricId?: string;
          metricIds: (string)[];
          variationIds: (string)[];
          /** @enum {string} */
          differenceType: "absolute" | "relative" | "scaled";
          sliceTagsFilter: (string)[];
          metricTagFilter: (string)[];
          sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
          sortDirection: ("asc" | "desc") | null;
        }) | {
          organization: string;
          id: string;
          uid: string;
          /** @constant */
          type: "experiment-traffic";
          title: string;
          description: string;
          snapshotId?: string;
          experimentId: string;
          showTable: boolean;
          showTimeseries: boolean;
        } | {
          organization: string;
          id: string;
          uid: string;
          /** @constant */
          type: "sql-explorer";
          title: string;
          description: string;
          snapshotId?: string;
          savedQueryId: string;
          dataVizConfigIndex?: number;
          blockConfig: (string)[];
        } | ({
          organization: string;
          id: string;
          uid: string;
          /** @constant */
          type: "metric-exploration";
          title: string;
          description: string;
          snapshotId?: string;
          explorerAnalysisId: string;
          config: {
            /** @description ID of the datasource to query */
            datasource: string;
            dimensions: (({
                /** @constant */
                dimensionType: "date";
                column: string | null;
                /** @enum {string} */
                dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
              }) | ({
                /** @constant */
                dimensionType: "dynamic";
                column: string | null;
                maxValues: number;
              }) | {
                /** @constant */
                dimensionType: "static";
                column: string;
                values: (string)[];
              } | ({
                /** @constant */
                dimensionType: "slice";
                slices: ({
                    name: string;
                    filters: ({
                        /** @enum {string} */
                        operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                        column?: string;
                        values?: (string)[];
                      })[];
                  })[];
              }))[];
            /** @enum {string} */
            chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
            dateRange: {
              /** @enum {string} */
              predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
              lookbackValue?: number | null;
              lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
              startDate?: string | null;
              endDate?: string | null;
            };
            /** @constant */
            type: "metric";
            dataset: {
              /** @constant */
              type: "metric";
              values: ({
                  name: string;
                  rowFilters: ({
                      /** @enum {string} */
                      operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                      column?: string;
                      values?: (string)[];
                    })[];
                  /** @constant */
                  type: "metric";
                  metricId: string;
                  unit: string | null;
                  denominatorUnit: string | null;
                })[];
            };
          };
        }) | ({
          organization: string;
          id: string;
          uid: string;
          /** @constant */
          type: "fact-table-exploration";
          title: string;
          description: string;
          snapshotId?: string;
          explorerAnalysisId: string;
          config: {
            /** @description ID of the datasource to query */
            datasource: string;
            dimensions: (({
                /** @constant */
                dimensionType: "date";
                column: string | null;
                /** @enum {string} */
                dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
              }) | ({
                /** @constant */
                dimensionType: "dynamic";
                column: string | null;
                maxValues: number;
              }) | {
                /** @constant */
                dimensionType: "static";
                column: string;
                values: (string)[];
              } | ({
                /** @constant */
                dimensionType: "slice";
                slices: ({
                    name: string;
                    filters: ({
                        /** @enum {string} */
                        operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                        column?: string;
                        values?: (string)[];
                      })[];
                  })[];
              }))[];
            /** @enum {string} */
            chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
            dateRange: {
              /** @enum {string} */
              predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
              lookbackValue?: number | null;
              lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
              startDate?: string | null;
              endDate?: string | null;
            };
            /** @constant */
            type: "fact_table";
            dataset: {
              /** @constant */
              type: "fact_table";
              factTableId: string | null;
              values: ({
                  name: string;
                  rowFilters: ({
                      /** @enum {string} */
                      operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                      column?: string;
                      values?: (string)[];
                    })[];
                  /** @constant */
                  type: "fact_table";
                  /** @enum {string} */
                  valueType: "unit_count" | "count" | "sum";
                  valueColumn: string | null;
                  unit: string | null;
                })[];
            };
          };
        }) | ({
          organization: string;
          id: string;
          uid: string;
          /** @constant */
          type: "data-source-exploration";
          title: string;
          description: string;
          snapshotId?: string;
          explorerAnalysisId: string;
          config: {
            /** @description ID of the datasource to query */
            datasource: string;
            dimensions: (({
                /** @constant */
                dimensionType: "date";
                column: string | null;
                /** @enum {string} */
                dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
              }) | ({
                /** @constant */
                dimensionType: "dynamic";
                column: string | null;
                maxValues: number;
              }) | {
                /** @constant */
                dimensionType: "static";
                column: string;
                values: (string)[];
              } | ({
                /** @constant */
                dimensionType: "slice";
                slices: ({
                    name: string;
                    filters: ({
                        /** @enum {string} */
                        operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                        column?: string;
                        values?: (string)[];
                      })[];
                  })[];
              }))[];
            /** @enum {string} */
            chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
            dateRange: {
              /** @enum {string} */
              predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
              lookbackValue?: number | null;
              lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
              startDate?: string | null;
              endDate?: string | null;
            };
            /** @constant */
            type: "data_source";
            dataset: {
              /** @constant */
              type: "data_source";
              table: string;
              path: string;
              timestampColumn: string;
              columnTypes: {
                [key: string]: ("string" | "number" | "date" | "boolean" | "other") | undefined;
              };
              values: ({
                  name: string;
                  rowFilters: ({
                      /** @enum {string} */
                      operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                      column?: string;
                      values?: (string)[];
                    })[];
                  /** @constant */
                  type: "data_source";
                  /** @enum {string} */
                  valueType: "unit_count" | "count" | "sum";
                  valueColumn: string | null;
                  unit: string | null;
                })[];
            };
          };
        }))[];
    };
    ExperimentTemplate: {
      id: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      project?: string;
      /** @description The userId of the owner (or raw owner name/email for legacy records) */
      owner: string;
      templateMetadata: {
        name: string;
        description?: string;
      };
      /** @enum {string} */
      type: "standard";
      hypothesis?: string;
      description?: string;
      tags?: (string)[];
      customFields?: {
        [key: string]: string | undefined;
      };
      datasource: string;
      exposureQueryId: string;
      hashAttribute?: string;
      fallbackAttribute?: string;
      disableStickyBucketing?: boolean;
      goalMetrics?: (string)[];
      secondaryMetrics?: (string)[];
      guardrailMetrics?: (string)[];
      activationMetric?: string;
      /** @enum {string} */
      statsEngine: "bayesian" | "frequentist";
      segment?: string;
      skipPartialData?: boolean;
      targeting: {
        coverage: number;
        savedGroups?: ({
            /** @enum {string} */
            match: "all" | "none" | "any";
            ids: (string)[];
          })[];
        prerequisites?: ({
            id: string;
            condition: string;
          })[];
        condition: string;
      };
      customMetricSlices?: ({
          slices: ({
              column: string;
              levels: (string)[];
            })[];
        })[];
    };
    MetricGroup: {
      id: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      /** @description The userId of the owner (or raw owner name/email for legacy records) */
      owner: string;
      name: string;
      description: string;
      tags: (string)[];
      projects: (string)[];
      metrics: (string)[];
      datasource: string;
      archived: boolean;
    };
    RampScheduleTemplate: {
      id: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      name: string;
      steps: ({
          trigger: {
            /** @constant */
            type: "interval";
            seconds: number;
          } | {
            /** @constant */
            type: "approval";
          } | {
            /** @constant */
            type: "scheduled";
            /** Format: date-time */
            at: string;
          };
          actions: ({
              /** @constant */
              targetType: "feature-rule";
              targetId: string;
              patch: {
                ruleId: string;
                coverage?: number | null;
                condition?: string | null;
                savedGroups?: (({
                    /** @enum {string} */
                    match: "all" | "none" | "any";
                    ids: (string)[];
                  })[]) | null;
                prerequisites?: ({
                    id: string;
                    condition: string;
                  })[] | null;
                enabled?: boolean | null;
              };
            })[];
          approvalNotes?: string | null;
        })[];
      endPatch?: {
        coverage?: number;
        condition?: string;
        savedGroups?: ({
            /** @enum {string} */
            match: "all" | "none" | "any";
            ids: (string)[];
          })[];
        prerequisites?: ({
            id: string;
            condition: string;
          })[];
      };
      official?: boolean;
    };
    RampSchedule: {
      id: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      name: string;
      /** @enum {string} */
      entityType: "feature";
      entityId: string;
      targets: ({
          id: string;
          /** @enum {string} */
          entityType: "feature";
          entityId: string;
          ruleId?: string | null;
          environment?: string | null;
          /** @enum {string} */
          status: "pending-join" | "active";
          activatingRevisionVersion?: number | null;
        })[];
      steps: ({
          trigger: {
            /** @constant */
            type: "interval";
            seconds: number;
          } | {
            /** @constant */
            type: "approval";
          } | {
            /** @constant */
            type: "scheduled";
            /** Format: date-time */
            at: string;
          };
          actions: ({
              /** @constant */
              targetType: "feature-rule";
              targetId: string;
              patch: {
                ruleId: string;
                coverage?: number | null;
                condition?: string | null;
                savedGroups?: (({
                    /** @enum {string} */
                    match: "all" | "none" | "any";
                    ids: (string)[];
                  })[]) | null;
                prerequisites?: ({
                    id: string;
                    condition: string;
                  })[] | null;
                force?: any;
                enabled?: boolean | null;
              };
            })[];
          approvalNotes?: string | null;
        })[];
      endActions?: ({
          /** @constant */
          targetType: "feature-rule";
          targetId: string;
          patch: {
            ruleId: string;
            coverage?: number | null;
            condition?: string | null;
            savedGroups?: (({
                /** @enum {string} */
                match: "all" | "none" | "any";
                ids: (string)[];
              })[]) | null;
            prerequisites?: ({
                id: string;
                condition: string;
              })[] | null;
            force?: any;
            enabled?: boolean | null;
          };
        })[];
      startDate?: string | null;
      endCondition?: {
        trigger?: {
          /** @constant */
          type: "scheduled";
          /** Format: date-time */
          at: string;
        };
      } | null;
      /** @enum {string} */
      status: "pending" | "ready" | "running" | "paused" | "pending-approval" | "completed" | "rolled-back";
      currentStepIndex: number;
      startedAt?: string | null;
      phaseStartedAt?: string | null;
      pausedAt?: string | null;
      nextStepAt: string | null;
      nextProcessAt?: string | null;
      elapsedMs?: number | null;
    };
    Team: {
      id: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      name: string;
      createdBy: string;
      description: string;
      role: string;
      limitAccessByEnvironment: boolean;
      environments: (string)[];
      projectRoles?: ({
          role: string;
          limitAccessByEnvironment: boolean;
          environments: (string)[];
          teams?: (string)[];
          project: string;
        })[];
      members: readonly (string)[];
      managedByIdp: boolean;
      managedBy?: {
        /** @constant */
        type: "vercel";
        resourceId: string;
      };
      defaultProject?: string;
    };
  };
  responses: {
    Error: never;
  };
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}

export type external = Record<string, never>;

export interface operations {

  postMetricExploration: {
    /** Create a Metric based visualization */
    parameters: {
      query: {
        cache?: "preferred" | "required" | "never";
      };
    };
    requestBody: {
      content: {
        "application/json": {
          /** @description ID of the datasource to query */
          datasource: string;
          dimensions: (({
              /** @constant */
              dimensionType: "date";
              column: string | null;
              /** @enum {string} */
              dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
            }) | ({
              /** @constant */
              dimensionType: "dynamic";
              column: string | null;
              maxValues: number;
            }) | {
              /** @constant */
              dimensionType: "static";
              column: string;
              values: (string)[];
            } | ({
              /** @constant */
              dimensionType: "slice";
              slices: ({
                  name: string;
                  filters: ({
                      /** @enum {string} */
                      operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                      column?: string;
                      values?: (string)[];
                    })[];
                })[];
            }))[];
          /** @enum {string} */
          chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
          dateRange: {
            /** @enum {string} */
            predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
            lookbackValue?: number | null;
            lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
            startDate?: string | null;
            endDate?: string | null;
          };
          /** @constant */
          type: "metric";
          dataset: {
            /** @constant */
            type: "metric";
            values: ({
                name: string;
                rowFilters: ({
                    /** @enum {string} */
                    operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                    column?: string;
                    values?: (string)[];
                  })[];
                /** @constant */
                type: "metric";
                metricId: string;
                unit: string | null;
                denominatorUnit: string | null;
              })[];
          };
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            exploration: ({
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              datasource: string;
              /** @enum {string} */
              status: "running" | "success" | "error";
              dateStart: string;
              dateEnd: string;
              error?: string | null;
              result: {
                rows: ({
                    dimensions: (string | null)[];
                    values: ({
                        metricId: string;
                        numerator: number | null;
                        denominator: number | null;
                      })[];
                  })[];
              };
              config: {
                /** @description ID of the datasource to query */
                datasource: string;
                dimensions: (({
                    /** @constant */
                    dimensionType: "date";
                    column: string | null;
                    /** @enum {string} */
                    dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                  }) | ({
                    /** @constant */
                    dimensionType: "dynamic";
                    column: string | null;
                    maxValues: number;
                  }) | {
                    /** @constant */
                    dimensionType: "static";
                    column: string;
                    values: (string)[];
                  } | ({
                    /** @constant */
                    dimensionType: "slice";
                    slices: ({
                        name: string;
                        filters: ({
                            /** @enum {string} */
                            operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                            column?: string;
                            values?: (string)[];
                          })[];
                      })[];
                  }))[];
                /** @enum {string} */
                chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                dateRange: {
                  /** @enum {string} */
                  predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                  lookbackValue?: number | null;
                  lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                  startDate?: string | null;
                  endDate?: string | null;
                };
                /** @constant */
                type: "metric";
                dataset: {
                  /** @constant */
                  type: "metric";
                  values: ({
                      name: string;
                      rowFilters: ({
                          /** @enum {string} */
                          operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                          column?: string;
                          values?: (string)[];
                        })[];
                      /** @constant */
                      type: "metric";
                      metricId: string;
                      unit: string | null;
                      denominatorUnit: string | null;
                    })[];
                };
              };
            }) | null;
            query: ({
              id: string;
              organization: string;
              datasource: string;
              language: string;
              query: string;
              queryType: string;
              createdAt: string;
              startedAt: string;
              /** @enum {string} */
              status: "running" | "queued" | "failed" | "partially-succeeded" | "succeeded";
              externalId: string;
              dependencies: (string)[];
              runAtEnd: boolean;
            }) | null;
            /** @description A direct link to view this exploration in the GrowthBook Application. */
            explorationUrl?: string;
            /** @description Present when `exploration` is null, explaining why no result was returned. */
            message?: string;
          };
        };
      };
    };
  };
  postFactTableExploration: {
    /** Run a Fact Table based visualization */
    parameters: {
      query: {
        cache?: "preferred" | "required" | "never";
      };
    };
    requestBody: {
      content: {
        "application/json": {
          /** @description ID of the datasource to query */
          datasource: string;
          dimensions: (({
              /** @constant */
              dimensionType: "date";
              column: string | null;
              /** @enum {string} */
              dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
            }) | ({
              /** @constant */
              dimensionType: "dynamic";
              column: string | null;
              maxValues: number;
            }) | {
              /** @constant */
              dimensionType: "static";
              column: string;
              values: (string)[];
            } | ({
              /** @constant */
              dimensionType: "slice";
              slices: ({
                  name: string;
                  filters: ({
                      /** @enum {string} */
                      operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                      column?: string;
                      values?: (string)[];
                    })[];
                })[];
            }))[];
          /** @enum {string} */
          chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
          dateRange: {
            /** @enum {string} */
            predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
            lookbackValue?: number | null;
            lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
            startDate?: string | null;
            endDate?: string | null;
          };
          /** @constant */
          type: "fact_table";
          dataset: {
            /** @constant */
            type: "fact_table";
            factTableId: string | null;
            values: ({
                name: string;
                rowFilters: ({
                    /** @enum {string} */
                    operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                    column?: string;
                    values?: (string)[];
                  })[];
                /** @constant */
                type: "fact_table";
                /** @enum {string} */
                valueType: "unit_count" | "count" | "sum";
                valueColumn: string | null;
                unit: string | null;
              })[];
          };
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            exploration: ({
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              datasource: string;
              /** @enum {string} */
              status: "running" | "success" | "error";
              dateStart: string;
              dateEnd: string;
              error?: string | null;
              result: {
                rows: ({
                    dimensions: (string | null)[];
                    values: ({
                        metricId: string;
                        numerator: number | null;
                        denominator: number | null;
                      })[];
                  })[];
              };
              config: {
                /** @description ID of the datasource to query */
                datasource: string;
                dimensions: (({
                    /** @constant */
                    dimensionType: "date";
                    column: string | null;
                    /** @enum {string} */
                    dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                  }) | ({
                    /** @constant */
                    dimensionType: "dynamic";
                    column: string | null;
                    maxValues: number;
                  }) | {
                    /** @constant */
                    dimensionType: "static";
                    column: string;
                    values: (string)[];
                  } | ({
                    /** @constant */
                    dimensionType: "slice";
                    slices: ({
                        name: string;
                        filters: ({
                            /** @enum {string} */
                            operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                            column?: string;
                            values?: (string)[];
                          })[];
                      })[];
                  }))[];
                /** @enum {string} */
                chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                dateRange: {
                  /** @enum {string} */
                  predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                  lookbackValue?: number | null;
                  lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                  startDate?: string | null;
                  endDate?: string | null;
                };
                /** @constant */
                type: "fact_table";
                dataset: {
                  /** @constant */
                  type: "fact_table";
                  factTableId: string | null;
                  values: ({
                      name: string;
                      rowFilters: ({
                          /** @enum {string} */
                          operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                          column?: string;
                          values?: (string)[];
                        })[];
                      /** @constant */
                      type: "fact_table";
                      /** @enum {string} */
                      valueType: "unit_count" | "count" | "sum";
                      valueColumn: string | null;
                      unit: string | null;
                    })[];
                };
              };
            }) | null;
            query: ({
              id: string;
              organization: string;
              datasource: string;
              language: string;
              query: string;
              queryType: string;
              createdAt: string;
              startedAt: string;
              /** @enum {string} */
              status: "running" | "queued" | "failed" | "partially-succeeded" | "succeeded";
              externalId: string;
              dependencies: (string)[];
              runAtEnd: boolean;
            }) | null;
            /** @description A direct link to view this exploration in the GrowthBook Application. */
            explorationUrl?: string;
            /** @description Present when `exploration` is null, explaining why no result was returned. */
            message?: string;
          };
        };
      };
    };
  };
  postDataSourceExploration: {
    /** Create a Data Source based visualization */
    parameters: {
      query: {
        cache?: "preferred" | "required" | "never";
      };
    };
    requestBody: {
      content: {
        "application/json": {
          /** @description ID of the datasource to query */
          datasource: string;
          dimensions: (({
              /** @constant */
              dimensionType: "date";
              column: string | null;
              /** @enum {string} */
              dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
            }) | ({
              /** @constant */
              dimensionType: "dynamic";
              column: string | null;
              maxValues: number;
            }) | {
              /** @constant */
              dimensionType: "static";
              column: string;
              values: (string)[];
            } | ({
              /** @constant */
              dimensionType: "slice";
              slices: ({
                  name: string;
                  filters: ({
                      /** @enum {string} */
                      operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                      column?: string;
                      values?: (string)[];
                    })[];
                })[];
            }))[];
          /** @enum {string} */
          chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
          dateRange: {
            /** @enum {string} */
            predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
            lookbackValue?: number | null;
            lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
            startDate?: string | null;
            endDate?: string | null;
          };
          /** @constant */
          type: "data_source";
          dataset: {
            /** @constant */
            type: "data_source";
            table: string;
            path: string;
            timestampColumn: string;
            columnTypes: {
              [key: string]: ("string" | "number" | "date" | "boolean" | "other") | undefined;
            };
            values: ({
                name: string;
                rowFilters: ({
                    /** @enum {string} */
                    operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                    column?: string;
                    values?: (string)[];
                  })[];
                /** @constant */
                type: "data_source";
                /** @enum {string} */
                valueType: "unit_count" | "count" | "sum";
                valueColumn: string | null;
                unit: string | null;
              })[];
          };
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            exploration: ({
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              datasource: string;
              /** @enum {string} */
              status: "running" | "success" | "error";
              dateStart: string;
              dateEnd: string;
              error?: string | null;
              result: {
                rows: ({
                    dimensions: (string | null)[];
                    values: ({
                        metricId: string;
                        numerator: number | null;
                        denominator: number | null;
                      })[];
                  })[];
              };
              config: {
                /** @description ID of the datasource to query */
                datasource: string;
                dimensions: (({
                    /** @constant */
                    dimensionType: "date";
                    column: string | null;
                    /** @enum {string} */
                    dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                  }) | ({
                    /** @constant */
                    dimensionType: "dynamic";
                    column: string | null;
                    maxValues: number;
                  }) | {
                    /** @constant */
                    dimensionType: "static";
                    column: string;
                    values: (string)[];
                  } | ({
                    /** @constant */
                    dimensionType: "slice";
                    slices: ({
                        name: string;
                        filters: ({
                            /** @enum {string} */
                            operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                            column?: string;
                            values?: (string)[];
                          })[];
                      })[];
                  }))[];
                /** @enum {string} */
                chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                dateRange: {
                  /** @enum {string} */
                  predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                  lookbackValue?: number | null;
                  lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                  startDate?: string | null;
                  endDate?: string | null;
                };
                /** @constant */
                type: "data_source";
                dataset: {
                  /** @constant */
                  type: "data_source";
                  table: string;
                  path: string;
                  timestampColumn: string;
                  columnTypes: {
                    [key: string]: ("string" | "number" | "date" | "boolean" | "other") | undefined;
                  };
                  values: ({
                      name: string;
                      rowFilters: ({
                          /** @enum {string} */
                          operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                          column?: string;
                          values?: (string)[];
                        })[];
                      /** @constant */
                      type: "data_source";
                      /** @enum {string} */
                      valueType: "unit_count" | "count" | "sum";
                      valueColumn: string | null;
                      unit: string | null;
                    })[];
                };
              };
            }) | null;
            query: ({
              id: string;
              organization: string;
              datasource: string;
              language: string;
              query: string;
              queryType: string;
              createdAt: string;
              startedAt: string;
              /** @enum {string} */
              status: "running" | "queued" | "failed" | "partially-succeeded" | "succeeded";
              externalId: string;
              dependencies: (string)[];
              runAtEnd: boolean;
            }) | null;
            /** @description A direct link to view this exploration in the GrowthBook Application. */
            explorationUrl?: string;
            /** @description Present when `exploration` is null, explaining why no result was returned. */
            message?: string;
          };
        };
      };
    };
  };
  listCustomFields: {
    /** Get all custom fields */
    parameters: {
      query: {
        projectId?: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": ({
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              description?: string;
              placeholder?: string;
              defaultValue?: string | number | boolean | string | string | (string)[] | (number)[] | (boolean)[] | (string)[] | (string)[];
              /** @enum {string} */
              type: "text" | "textarea" | "markdown" | "enum" | "multiselect" | "url" | "number" | "boolean" | "date" | "datetime";
              values?: string;
              required: boolean;
              creator?: string;
              projects?: (string)[];
              sections: ("feature" | "experiment")[];
              active?: boolean;
            })[];
        };
      };
    };
  };
  createCustomField: {
    /** Create a single customField */
    requestBody: {
      content: {
        "application/json": {
          /** @description The unique key for the custom field */
          id: string;
          /** @description The display name of the custom field */
          name: string;
          description?: string;
          placeholder?: string;
          defaultValue?: string | number | boolean | string | string | (string)[] | (number)[] | (boolean)[] | (string)[] | (string)[];
          /**
           * @description The type of value this custom field will take 
           * @enum {string}
           */
          type: "text" | "textarea" | "markdown" | "enum" | "multiselect" | "url" | "number" | "boolean" | "date" | "datetime";
          values?: string;
          required: boolean;
          projects?: (string)[];
          /** @description What types of objects this custom field is applicable to (feature, experiment) */
          sections: ("feature" | "experiment")[];
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            customField: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              description?: string;
              placeholder?: string;
              defaultValue?: string | number | boolean | string | string | (string)[] | (number)[] | (boolean)[] | (string)[] | (string)[];
              /** @enum {string} */
              type: "text" | "textarea" | "markdown" | "enum" | "multiselect" | "url" | "number" | "boolean" | "date" | "datetime";
              values?: string;
              required: boolean;
              creator?: string;
              projects?: (string)[];
              sections: ("feature" | "experiment")[];
              active?: boolean;
            };
          };
        };
      };
    };
  };
  getCustomField: {
    /** Get a single customField */
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            customField: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              description?: string;
              placeholder?: string;
              defaultValue?: string | number | boolean | string | string | (string)[] | (number)[] | (boolean)[] | (string)[] | (string)[];
              /** @enum {string} */
              type: "text" | "textarea" | "markdown" | "enum" | "multiselect" | "url" | "number" | "boolean" | "date" | "datetime";
              values?: string;
              required: boolean;
              creator?: string;
              projects?: (string)[];
              sections: ("feature" | "experiment")[];
              active?: boolean;
            };
          };
        };
      };
    };
  };
  updateCustomField: {
    /** Update a single customField */
    parameters: {
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          /** @description The display name of the custom field */
          name?: string;
          description?: string;
          placeholder?: string;
          defaultValue?: string | number | boolean | string | string | (string)[] | (number)[] | (boolean)[] | (string)[] | (string)[];
          values?: string;
          required?: boolean;
          projects?: (string)[];
          /** @description What types of objects this custom field is applicable to (feature, experiment) */
          sections?: ("feature" | "experiment")[];
          active?: boolean;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            customField: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              description?: string;
              placeholder?: string;
              defaultValue?: string | number | boolean | string | string | (string)[] | (number)[] | (boolean)[] | (string)[] | (string)[];
              /** @enum {string} */
              type: "text" | "textarea" | "markdown" | "enum" | "multiselect" | "url" | "number" | "boolean" | "date" | "datetime";
              values?: string;
              required: boolean;
              creator?: string;
              projects?: (string)[];
              sections: ("feature" | "experiment")[];
              active?: boolean;
            };
          };
        };
      };
    };
  };
  deleteCustomField: {
    /** Delete a single customField */
    parameters: {
      query: {
        index?: string;
      };
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            deletedId: string;
          };
        };
      };
    };
  };
  getDashboard: {
    /** Get a single dashboard */
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            dashboard: {
              id: string;
              uid: string;
              organization: string;
              experimentId?: string;
              isDefault: boolean;
              isDeleted: boolean;
              userId: string;
              /** @enum {string} */
              editLevel: "published" | "private";
              /** @enum {string} */
              shareLevel: "published" | "private";
              enableAutoUpdates: boolean;
              updateSchedule?: {
                /** @constant */
                type: "stale";
                hours: number;
              } | {
                /** @constant */
                type: "cron";
                cron: string;
              };
              title: string;
              projects?: (string)[];
              /** Format: date-time */
              nextUpdate?: string;
              /** Format: date-time */
              lastUpdated?: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              blocks: (({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "metric-explorer";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  factMetricId: string;
                  /** @enum {string} */
                  visualizationType: "histogram" | "bigNumber" | "timeseries";
                  /** @enum {string} */
                  valueType: "avg" | "sum";
                  metricAnalysisId: string;
                  analysisSettings: {
                    userIdType: string;
                    lookbackDays: number;
                    /** @enum {string} */
                    populationType: "metric" | "factTable" | "exposureQuery" | "population" | "segment";
                    populationId: string | null;
                    additionalNumeratorFilters?: (string)[];
                    additionalDenominatorFilters?: (string)[];
                    startDate: string;
                    endDate: string;
                  };
                }) | {
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "markdown";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  content: string;
                } | {
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-metadata";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  experimentId: string;
                  showDescription: boolean;
                  showHypothesis: boolean;
                  showVariationImages: boolean;
                  variationIds?: (string)[];
                } | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-metric";
                  title: string;
                  description: string;
                  snapshotId: string;
                  experimentId: string;
                  metricIds: (string)[];
                  variationIds: (string)[];
                  baselineRow: number;
                  /** @enum {string} */
                  differenceType: "absolute" | "relative" | "scaled";
                  columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
                  sliceTagsFilter: (string)[];
                  metricTagFilter: (string)[];
                  sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                  sortDirection: ("asc" | "desc") | null;
                }) | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-dimension";
                  title: string;
                  description: string;
                  snapshotId: string;
                  experimentId: string;
                  dimensionId: string;
                  dimensionValues: (string)[];
                  metricIds: (string)[];
                  variationIds: (string)[];
                  baselineRow: number;
                  /** @enum {string} */
                  differenceType: "absolute" | "relative" | "scaled";
                  columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
                  metricTagFilter: (string)[];
                  sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                  sortDirection: ("asc" | "desc") | null;
                }) | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-time-series";
                  title: string;
                  description: string;
                  snapshotId: string;
                  experimentId: string;
                  metricId?: string;
                  metricIds: (string)[];
                  variationIds: (string)[];
                  /** @enum {string} */
                  differenceType: "absolute" | "relative" | "scaled";
                  sliceTagsFilter: (string)[];
                  metricTagFilter: (string)[];
                  sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                  sortDirection: ("asc" | "desc") | null;
                }) | {
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-traffic";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  experimentId: string;
                  showTable: boolean;
                  showTimeseries: boolean;
                } | {
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "sql-explorer";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  savedQueryId: string;
                  dataVizConfigIndex?: number;
                  blockConfig: (string)[];
                } | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "metric-exploration";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  explorerAnalysisId: string;
                  config: {
                    /** @description ID of the datasource to query */
                    datasource: string;
                    dimensions: (({
                        /** @constant */
                        dimensionType: "date";
                        column: string | null;
                        /** @enum {string} */
                        dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                      }) | ({
                        /** @constant */
                        dimensionType: "dynamic";
                        column: string | null;
                        maxValues: number;
                      }) | {
                        /** @constant */
                        dimensionType: "static";
                        column: string;
                        values: (string)[];
                      } | ({
                        /** @constant */
                        dimensionType: "slice";
                        slices: ({
                            name: string;
                            filters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                          })[];
                      }))[];
                    /** @enum {string} */
                    chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                    dateRange: {
                      /** @enum {string} */
                      predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                      lookbackValue?: number | null;
                      lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                      startDate?: string | null;
                      endDate?: string | null;
                    };
                    /** @constant */
                    type: "metric";
                    dataset: {
                      /** @constant */
                      type: "metric";
                      values: ({
                          name: string;
                          rowFilters: ({
                              /** @enum {string} */
                              operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                              column?: string;
                              values?: (string)[];
                            })[];
                          /** @constant */
                          type: "metric";
                          metricId: string;
                          unit: string | null;
                          denominatorUnit: string | null;
                        })[];
                    };
                  };
                }) | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "fact-table-exploration";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  explorerAnalysisId: string;
                  config: {
                    /** @description ID of the datasource to query */
                    datasource: string;
                    dimensions: (({
                        /** @constant */
                        dimensionType: "date";
                        column: string | null;
                        /** @enum {string} */
                        dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                      }) | ({
                        /** @constant */
                        dimensionType: "dynamic";
                        column: string | null;
                        maxValues: number;
                      }) | {
                        /** @constant */
                        dimensionType: "static";
                        column: string;
                        values: (string)[];
                      } | ({
                        /** @constant */
                        dimensionType: "slice";
                        slices: ({
                            name: string;
                            filters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                          })[];
                      }))[];
                    /** @enum {string} */
                    chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                    dateRange: {
                      /** @enum {string} */
                      predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                      lookbackValue?: number | null;
                      lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                      startDate?: string | null;
                      endDate?: string | null;
                    };
                    /** @constant */
                    type: "fact_table";
                    dataset: {
                      /** @constant */
                      type: "fact_table";
                      factTableId: string | null;
                      values: ({
                          name: string;
                          rowFilters: ({
                              /** @enum {string} */
                              operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                              column?: string;
                              values?: (string)[];
                            })[];
                          /** @constant */
                          type: "fact_table";
                          /** @enum {string} */
                          valueType: "unit_count" | "count" | "sum";
                          valueColumn: string | null;
                          unit: string | null;
                        })[];
                    };
                  };
                }) | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "data-source-exploration";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  explorerAnalysisId: string;
                  config: {
                    /** @description ID of the datasource to query */
                    datasource: string;
                    dimensions: (({
                        /** @constant */
                        dimensionType: "date";
                        column: string | null;
                        /** @enum {string} */
                        dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                      }) | ({
                        /** @constant */
                        dimensionType: "dynamic";
                        column: string | null;
                        maxValues: number;
                      }) | {
                        /** @constant */
                        dimensionType: "static";
                        column: string;
                        values: (string)[];
                      } | ({
                        /** @constant */
                        dimensionType: "slice";
                        slices: ({
                            name: string;
                            filters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                          })[];
                      }))[];
                    /** @enum {string} */
                    chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                    dateRange: {
                      /** @enum {string} */
                      predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                      lookbackValue?: number | null;
                      lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                      startDate?: string | null;
                      endDate?: string | null;
                    };
                    /** @constant */
                    type: "data_source";
                    dataset: {
                      /** @constant */
                      type: "data_source";
                      table: string;
                      path: string;
                      timestampColumn: string;
                      columnTypes: {
                        [key: string]: ("string" | "number" | "date" | "boolean" | "other") | undefined;
                      };
                      values: ({
                          name: string;
                          rowFilters: ({
                              /** @enum {string} */
                              operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                              column?: string;
                              values?: (string)[];
                            })[];
                          /** @constant */
                          type: "data_source";
                          /** @enum {string} */
                          valueType: "unit_count" | "count" | "sum";
                          valueColumn: string | null;
                          unit: string | null;
                        })[];
                    };
                  };
                }))[];
            };
          };
        };
      };
    };
  };
  updateDashboard: {
    /** Update a single dashboard */
    parameters: {
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          /** @description The display name of the Dashboard */
          title?: string;
          /**
           * @description Dashboards that are "published" are editable by organization members with appropriate permissions 
           * @enum {string}
           */
          editLevel?: "published" | "private";
          /**
           * @description General Dashboards only. Dashboards that are "published" are viewable by organization members with appropriate permissions 
           * @enum {string}
           */
          shareLevel?: "published" | "private";
          /** @description If enabled for a General Dashboard, also requires an updateSchedule */
          enableAutoUpdates?: boolean;
          /** @description General Dashboards only. Experiment Dashboards update based on the parent experiment instead */
          updateSchedule?: {
            /** @constant */
            type: "stale";
            hours: number;
          } | {
            /** @constant */
            type: "cron";
            cron: string;
          };
          /** @description General Dashboards only, Experiment Dashboards use the experiment's projects */
          projects?: (string)[];
          blocks?: (({
              /** @constant */
              type: "markdown";
              title: string;
              description: string;
              snapshotId?: string;
              content: string;
            } | {
              /** @constant */
              type: "experiment-metadata";
              title: string;
              description: string;
              snapshotId?: string;
              experimentId: string;
              showDescription: boolean;
              showHypothesis: boolean;
              showVariationImages: boolean;
              variationIds?: (string)[];
            } | ({
              /** @constant */
              type: "experiment-metric";
              title: string;
              description: string;
              snapshotId: string;
              experimentId: string;
              metricIds: (string)[];
              variationIds: (string)[];
              baselineRow: number;
              /** @enum {string} */
              differenceType: "absolute" | "relative" | "scaled";
              columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
              sliceTagsFilter: (string)[];
              metricTagFilter: (string)[];
              sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
              sortDirection: ("asc" | "desc") | null;
            }) | ({
              /** @constant */
              type: "experiment-dimension";
              title: string;
              description: string;
              snapshotId: string;
              experimentId: string;
              dimensionId: string;
              dimensionValues: (string)[];
              metricIds: (string)[];
              variationIds: (string)[];
              baselineRow: number;
              /** @enum {string} */
              differenceType: "absolute" | "relative" | "scaled";
              columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
              metricTagFilter: (string)[];
              sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
              sortDirection: ("asc" | "desc") | null;
            }) | ({
              /** @constant */
              type: "experiment-time-series";
              title: string;
              description: string;
              snapshotId: string;
              experimentId: string;
              metricId?: string;
              metricIds: (string)[];
              variationIds: (string)[];
              /** @enum {string} */
              differenceType: "absolute" | "relative" | "scaled";
              sliceTagsFilter: (string)[];
              metricTagFilter: (string)[];
              sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
              sortDirection: ("asc" | "desc") | null;
            }) | {
              /** @constant */
              type: "experiment-traffic";
              title: string;
              description: string;
              snapshotId?: string;
              experimentId: string;
              showTable: boolean;
              showTimeseries: boolean;
            } | {
              /** @constant */
              type: "sql-explorer";
              title: string;
              description: string;
              snapshotId?: string;
              savedQueryId: string;
              dataVizConfigIndex?: number;
              blockConfig: (string)[];
            } | ({
              /** @constant */
              type: "metric-explorer";
              title: string;
              description: string;
              snapshotId?: string;
              factMetricId: string;
              /** @enum {string} */
              visualizationType: "histogram" | "bigNumber" | "timeseries";
              /** @enum {string} */
              valueType: "avg" | "sum";
              metricAnalysisId: string;
              analysisSettings: {
                userIdType: string;
                lookbackDays: number;
                /** @enum {string} */
                populationType: "metric" | "factTable" | "exposureQuery" | "population" | "segment";
                populationId: string | null;
                additionalNumeratorFilters?: (string)[];
                additionalDenominatorFilters?: (string)[];
                startDate: string;
                endDate: string;
              };
            })) | (({
              organization: string;
              id: string;
              uid: string;
              /** @constant */
              type: "metric-explorer";
              title: string;
              description: string;
              snapshotId?: string;
              factMetricId: string;
              /** @enum {string} */
              visualizationType: "histogram" | "bigNumber" | "timeseries";
              /** @enum {string} */
              valueType: "avg" | "sum";
              metricAnalysisId: string;
              analysisSettings: {
                userIdType: string;
                lookbackDays: number;
                /** @enum {string} */
                populationType: "metric" | "factTable" | "exposureQuery" | "population" | "segment";
                populationId: string | null;
                additionalNumeratorFilters?: (string)[];
                additionalDenominatorFilters?: (string)[];
                startDate: string;
                endDate: string;
              };
            }) | {
              organization: string;
              id: string;
              uid: string;
              /** @constant */
              type: "markdown";
              title: string;
              description: string;
              snapshotId?: string;
              content: string;
            } | {
              organization: string;
              id: string;
              uid: string;
              /** @constant */
              type: "experiment-metadata";
              title: string;
              description: string;
              snapshotId?: string;
              experimentId: string;
              showDescription: boolean;
              showHypothesis: boolean;
              showVariationImages: boolean;
              variationIds?: (string)[];
            } | ({
              organization: string;
              id: string;
              uid: string;
              /** @constant */
              type: "experiment-metric";
              title: string;
              description: string;
              snapshotId: string;
              experimentId: string;
              metricIds: (string)[];
              variationIds: (string)[];
              baselineRow: number;
              /** @enum {string} */
              differenceType: "absolute" | "relative" | "scaled";
              columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
              sliceTagsFilter: (string)[];
              metricTagFilter: (string)[];
              sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
              sortDirection: ("asc" | "desc") | null;
            }) | ({
              organization: string;
              id: string;
              uid: string;
              /** @constant */
              type: "experiment-dimension";
              title: string;
              description: string;
              snapshotId: string;
              experimentId: string;
              dimensionId: string;
              dimensionValues: (string)[];
              metricIds: (string)[];
              variationIds: (string)[];
              baselineRow: number;
              /** @enum {string} */
              differenceType: "absolute" | "relative" | "scaled";
              columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
              metricTagFilter: (string)[];
              sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
              sortDirection: ("asc" | "desc") | null;
            }) | ({
              organization: string;
              id: string;
              uid: string;
              /** @constant */
              type: "experiment-time-series";
              title: string;
              description: string;
              snapshotId: string;
              experimentId: string;
              metricId?: string;
              metricIds: (string)[];
              variationIds: (string)[];
              /** @enum {string} */
              differenceType: "absolute" | "relative" | "scaled";
              sliceTagsFilter: (string)[];
              metricTagFilter: (string)[];
              sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
              sortDirection: ("asc" | "desc") | null;
            }) | {
              organization: string;
              id: string;
              uid: string;
              /** @constant */
              type: "experiment-traffic";
              title: string;
              description: string;
              snapshotId?: string;
              experimentId: string;
              showTable: boolean;
              showTimeseries: boolean;
            } | {
              organization: string;
              id: string;
              uid: string;
              /** @constant */
              type: "sql-explorer";
              title: string;
              description: string;
              snapshotId?: string;
              savedQueryId: string;
              dataVizConfigIndex?: number;
              blockConfig: (string)[];
            } | ({
              organization: string;
              id: string;
              uid: string;
              /** @constant */
              type: "metric-exploration";
              title: string;
              description: string;
              snapshotId?: string;
              explorerAnalysisId: string;
              config: {
                /** @description ID of the datasource to query */
                datasource: string;
                dimensions: (({
                    /** @constant */
                    dimensionType: "date";
                    column: string | null;
                    /** @enum {string} */
                    dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                  }) | ({
                    /** @constant */
                    dimensionType: "dynamic";
                    column: string | null;
                    maxValues: number;
                  }) | {
                    /** @constant */
                    dimensionType: "static";
                    column: string;
                    values: (string)[];
                  } | ({
                    /** @constant */
                    dimensionType: "slice";
                    slices: ({
                        name: string;
                        filters: ({
                            /** @enum {string} */
                            operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                            column?: string;
                            values?: (string)[];
                          })[];
                      })[];
                  }))[];
                /** @enum {string} */
                chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                dateRange: {
                  /** @enum {string} */
                  predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                  lookbackValue?: number | null;
                  lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                  startDate?: string | null;
                  endDate?: string | null;
                };
                /** @constant */
                type: "metric";
                dataset: {
                  /** @constant */
                  type: "metric";
                  values: ({
                      name: string;
                      rowFilters: ({
                          /** @enum {string} */
                          operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                          column?: string;
                          values?: (string)[];
                        })[];
                      /** @constant */
                      type: "metric";
                      metricId: string;
                      unit: string | null;
                      denominatorUnit: string | null;
                    })[];
                };
              };
            }) | ({
              organization: string;
              id: string;
              uid: string;
              /** @constant */
              type: "fact-table-exploration";
              title: string;
              description: string;
              snapshotId?: string;
              explorerAnalysisId: string;
              config: {
                /** @description ID of the datasource to query */
                datasource: string;
                dimensions: (({
                    /** @constant */
                    dimensionType: "date";
                    column: string | null;
                    /** @enum {string} */
                    dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                  }) | ({
                    /** @constant */
                    dimensionType: "dynamic";
                    column: string | null;
                    maxValues: number;
                  }) | {
                    /** @constant */
                    dimensionType: "static";
                    column: string;
                    values: (string)[];
                  } | ({
                    /** @constant */
                    dimensionType: "slice";
                    slices: ({
                        name: string;
                        filters: ({
                            /** @enum {string} */
                            operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                            column?: string;
                            values?: (string)[];
                          })[];
                      })[];
                  }))[];
                /** @enum {string} */
                chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                dateRange: {
                  /** @enum {string} */
                  predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                  lookbackValue?: number | null;
                  lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                  startDate?: string | null;
                  endDate?: string | null;
                };
                /** @constant */
                type: "fact_table";
                dataset: {
                  /** @constant */
                  type: "fact_table";
                  factTableId: string | null;
                  values: ({
                      name: string;
                      rowFilters: ({
                          /** @enum {string} */
                          operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                          column?: string;
                          values?: (string)[];
                        })[];
                      /** @constant */
                      type: "fact_table";
                      /** @enum {string} */
                      valueType: "unit_count" | "count" | "sum";
                      valueColumn: string | null;
                      unit: string | null;
                    })[];
                };
              };
            }) | ({
              organization: string;
              id: string;
              uid: string;
              /** @constant */
              type: "data-source-exploration";
              title: string;
              description: string;
              snapshotId?: string;
              explorerAnalysisId: string;
              config: {
                /** @description ID of the datasource to query */
                datasource: string;
                dimensions: (({
                    /** @constant */
                    dimensionType: "date";
                    column: string | null;
                    /** @enum {string} */
                    dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                  }) | ({
                    /** @constant */
                    dimensionType: "dynamic";
                    column: string | null;
                    maxValues: number;
                  }) | {
                    /** @constant */
                    dimensionType: "static";
                    column: string;
                    values: (string)[];
                  } | ({
                    /** @constant */
                    dimensionType: "slice";
                    slices: ({
                        name: string;
                        filters: ({
                            /** @enum {string} */
                            operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                            column?: string;
                            values?: (string)[];
                          })[];
                      })[];
                  }))[];
                /** @enum {string} */
                chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                dateRange: {
                  /** @enum {string} */
                  predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                  lookbackValue?: number | null;
                  lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                  startDate?: string | null;
                  endDate?: string | null;
                };
                /** @constant */
                type: "data_source";
                dataset: {
                  /** @constant */
                  type: "data_source";
                  table: string;
                  path: string;
                  timestampColumn: string;
                  columnTypes: {
                    [key: string]: ("string" | "number" | "date" | "boolean" | "other") | undefined;
                  };
                  values: ({
                      name: string;
                      rowFilters: ({
                          /** @enum {string} */
                          operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                          column?: string;
                          values?: (string)[];
                        })[];
                      /** @constant */
                      type: "data_source";
                      /** @enum {string} */
                      valueType: "unit_count" | "count" | "sum";
                      valueColumn: string | null;
                      unit: string | null;
                    })[];
                };
              };
            })))[];
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            dashboard: {
              id: string;
              uid: string;
              organization: string;
              experimentId?: string;
              isDefault: boolean;
              isDeleted: boolean;
              userId: string;
              /** @enum {string} */
              editLevel: "published" | "private";
              /** @enum {string} */
              shareLevel: "published" | "private";
              enableAutoUpdates: boolean;
              updateSchedule?: {
                /** @constant */
                type: "stale";
                hours: number;
              } | {
                /** @constant */
                type: "cron";
                cron: string;
              };
              title: string;
              projects?: (string)[];
              /** Format: date-time */
              nextUpdate?: string;
              /** Format: date-time */
              lastUpdated?: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              blocks: (({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "metric-explorer";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  factMetricId: string;
                  /** @enum {string} */
                  visualizationType: "histogram" | "bigNumber" | "timeseries";
                  /** @enum {string} */
                  valueType: "avg" | "sum";
                  metricAnalysisId: string;
                  analysisSettings: {
                    userIdType: string;
                    lookbackDays: number;
                    /** @enum {string} */
                    populationType: "metric" | "factTable" | "exposureQuery" | "population" | "segment";
                    populationId: string | null;
                    additionalNumeratorFilters?: (string)[];
                    additionalDenominatorFilters?: (string)[];
                    startDate: string;
                    endDate: string;
                  };
                }) | {
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "markdown";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  content: string;
                } | {
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-metadata";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  experimentId: string;
                  showDescription: boolean;
                  showHypothesis: boolean;
                  showVariationImages: boolean;
                  variationIds?: (string)[];
                } | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-metric";
                  title: string;
                  description: string;
                  snapshotId: string;
                  experimentId: string;
                  metricIds: (string)[];
                  variationIds: (string)[];
                  baselineRow: number;
                  /** @enum {string} */
                  differenceType: "absolute" | "relative" | "scaled";
                  columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
                  sliceTagsFilter: (string)[];
                  metricTagFilter: (string)[];
                  sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                  sortDirection: ("asc" | "desc") | null;
                }) | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-dimension";
                  title: string;
                  description: string;
                  snapshotId: string;
                  experimentId: string;
                  dimensionId: string;
                  dimensionValues: (string)[];
                  metricIds: (string)[];
                  variationIds: (string)[];
                  baselineRow: number;
                  /** @enum {string} */
                  differenceType: "absolute" | "relative" | "scaled";
                  columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
                  metricTagFilter: (string)[];
                  sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                  sortDirection: ("asc" | "desc") | null;
                }) | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-time-series";
                  title: string;
                  description: string;
                  snapshotId: string;
                  experimentId: string;
                  metricId?: string;
                  metricIds: (string)[];
                  variationIds: (string)[];
                  /** @enum {string} */
                  differenceType: "absolute" | "relative" | "scaled";
                  sliceTagsFilter: (string)[];
                  metricTagFilter: (string)[];
                  sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                  sortDirection: ("asc" | "desc") | null;
                }) | {
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-traffic";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  experimentId: string;
                  showTable: boolean;
                  showTimeseries: boolean;
                } | {
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "sql-explorer";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  savedQueryId: string;
                  dataVizConfigIndex?: number;
                  blockConfig: (string)[];
                } | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "metric-exploration";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  explorerAnalysisId: string;
                  config: {
                    /** @description ID of the datasource to query */
                    datasource: string;
                    dimensions: (({
                        /** @constant */
                        dimensionType: "date";
                        column: string | null;
                        /** @enum {string} */
                        dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                      }) | ({
                        /** @constant */
                        dimensionType: "dynamic";
                        column: string | null;
                        maxValues: number;
                      }) | {
                        /** @constant */
                        dimensionType: "static";
                        column: string;
                        values: (string)[];
                      } | ({
                        /** @constant */
                        dimensionType: "slice";
                        slices: ({
                            name: string;
                            filters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                          })[];
                      }))[];
                    /** @enum {string} */
                    chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                    dateRange: {
                      /** @enum {string} */
                      predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                      lookbackValue?: number | null;
                      lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                      startDate?: string | null;
                      endDate?: string | null;
                    };
                    /** @constant */
                    type: "metric";
                    dataset: {
                      /** @constant */
                      type: "metric";
                      values: ({
                          name: string;
                          rowFilters: ({
                              /** @enum {string} */
                              operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                              column?: string;
                              values?: (string)[];
                            })[];
                          /** @constant */
                          type: "metric";
                          metricId: string;
                          unit: string | null;
                          denominatorUnit: string | null;
                        })[];
                    };
                  };
                }) | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "fact-table-exploration";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  explorerAnalysisId: string;
                  config: {
                    /** @description ID of the datasource to query */
                    datasource: string;
                    dimensions: (({
                        /** @constant */
                        dimensionType: "date";
                        column: string | null;
                        /** @enum {string} */
                        dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                      }) | ({
                        /** @constant */
                        dimensionType: "dynamic";
                        column: string | null;
                        maxValues: number;
                      }) | {
                        /** @constant */
                        dimensionType: "static";
                        column: string;
                        values: (string)[];
                      } | ({
                        /** @constant */
                        dimensionType: "slice";
                        slices: ({
                            name: string;
                            filters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                          })[];
                      }))[];
                    /** @enum {string} */
                    chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                    dateRange: {
                      /** @enum {string} */
                      predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                      lookbackValue?: number | null;
                      lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                      startDate?: string | null;
                      endDate?: string | null;
                    };
                    /** @constant */
                    type: "fact_table";
                    dataset: {
                      /** @constant */
                      type: "fact_table";
                      factTableId: string | null;
                      values: ({
                          name: string;
                          rowFilters: ({
                              /** @enum {string} */
                              operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                              column?: string;
                              values?: (string)[];
                            })[];
                          /** @constant */
                          type: "fact_table";
                          /** @enum {string} */
                          valueType: "unit_count" | "count" | "sum";
                          valueColumn: string | null;
                          unit: string | null;
                        })[];
                    };
                  };
                }) | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "data-source-exploration";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  explorerAnalysisId: string;
                  config: {
                    /** @description ID of the datasource to query */
                    datasource: string;
                    dimensions: (({
                        /** @constant */
                        dimensionType: "date";
                        column: string | null;
                        /** @enum {string} */
                        dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                      }) | ({
                        /** @constant */
                        dimensionType: "dynamic";
                        column: string | null;
                        maxValues: number;
                      }) | {
                        /** @constant */
                        dimensionType: "static";
                        column: string;
                        values: (string)[];
                      } | ({
                        /** @constant */
                        dimensionType: "slice";
                        slices: ({
                            name: string;
                            filters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                          })[];
                      }))[];
                    /** @enum {string} */
                    chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                    dateRange: {
                      /** @enum {string} */
                      predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                      lookbackValue?: number | null;
                      lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                      startDate?: string | null;
                      endDate?: string | null;
                    };
                    /** @constant */
                    type: "data_source";
                    dataset: {
                      /** @constant */
                      type: "data_source";
                      table: string;
                      path: string;
                      timestampColumn: string;
                      columnTypes: {
                        [key: string]: ("string" | "number" | "date" | "boolean" | "other") | undefined;
                      };
                      values: ({
                          name: string;
                          rowFilters: ({
                              /** @enum {string} */
                              operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                              column?: string;
                              values?: (string)[];
                            })[];
                          /** @constant */
                          type: "data_source";
                          /** @enum {string} */
                          valueType: "unit_count" | "count" | "sum";
                          valueColumn: string | null;
                          unit: string | null;
                        })[];
                    };
                  };
                }))[];
            };
          };
        };
      };
    };
  };
  deleteDashboard: {
    /** Delete a single dashboard */
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            deletedId: string;
          };
        };
      };
    };
  };
  listDashboards: {
    /** Get all dashboards */
    responses: {
      200: {
        content: {
          "application/json": {
            dashboards: ({
                id: string;
                uid: string;
                organization: string;
                experimentId?: string;
                isDefault: boolean;
                isDeleted: boolean;
                userId: string;
                /** @enum {string} */
                editLevel: "published" | "private";
                /** @enum {string} */
                shareLevel: "published" | "private";
                enableAutoUpdates: boolean;
                updateSchedule?: {
                  /** @constant */
                  type: "stale";
                  hours: number;
                } | {
                  /** @constant */
                  type: "cron";
                  cron: string;
                };
                title: string;
                projects?: (string)[];
                /** Format: date-time */
                nextUpdate?: string;
                /** Format: date-time */
                lastUpdated?: string;
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
                blocks: (({
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "metric-explorer";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    factMetricId: string;
                    /** @enum {string} */
                    visualizationType: "histogram" | "bigNumber" | "timeseries";
                    /** @enum {string} */
                    valueType: "avg" | "sum";
                    metricAnalysisId: string;
                    analysisSettings: {
                      userIdType: string;
                      lookbackDays: number;
                      /** @enum {string} */
                      populationType: "metric" | "factTable" | "exposureQuery" | "population" | "segment";
                      populationId: string | null;
                      additionalNumeratorFilters?: (string)[];
                      additionalDenominatorFilters?: (string)[];
                      startDate: string;
                      endDate: string;
                    };
                  }) | {
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "markdown";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    content: string;
                  } | {
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "experiment-metadata";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    experimentId: string;
                    showDescription: boolean;
                    showHypothesis: boolean;
                    showVariationImages: boolean;
                    variationIds?: (string)[];
                  } | ({
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "experiment-metric";
                    title: string;
                    description: string;
                    snapshotId: string;
                    experimentId: string;
                    metricIds: (string)[];
                    variationIds: (string)[];
                    baselineRow: number;
                    /** @enum {string} */
                    differenceType: "absolute" | "relative" | "scaled";
                    columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
                    sliceTagsFilter: (string)[];
                    metricTagFilter: (string)[];
                    sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                    sortDirection: ("asc" | "desc") | null;
                  }) | ({
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "experiment-dimension";
                    title: string;
                    description: string;
                    snapshotId: string;
                    experimentId: string;
                    dimensionId: string;
                    dimensionValues: (string)[];
                    metricIds: (string)[];
                    variationIds: (string)[];
                    baselineRow: number;
                    /** @enum {string} */
                    differenceType: "absolute" | "relative" | "scaled";
                    columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
                    metricTagFilter: (string)[];
                    sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                    sortDirection: ("asc" | "desc") | null;
                  }) | ({
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "experiment-time-series";
                    title: string;
                    description: string;
                    snapshotId: string;
                    experimentId: string;
                    metricId?: string;
                    metricIds: (string)[];
                    variationIds: (string)[];
                    /** @enum {string} */
                    differenceType: "absolute" | "relative" | "scaled";
                    sliceTagsFilter: (string)[];
                    metricTagFilter: (string)[];
                    sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                    sortDirection: ("asc" | "desc") | null;
                  }) | {
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "experiment-traffic";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    experimentId: string;
                    showTable: boolean;
                    showTimeseries: boolean;
                  } | {
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "sql-explorer";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    savedQueryId: string;
                    dataVizConfigIndex?: number;
                    blockConfig: (string)[];
                  } | ({
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "metric-exploration";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    explorerAnalysisId: string;
                    config: {
                      /** @description ID of the datasource to query */
                      datasource: string;
                      dimensions: (({
                          /** @constant */
                          dimensionType: "date";
                          column: string | null;
                          /** @enum {string} */
                          dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                        }) | ({
                          /** @constant */
                          dimensionType: "dynamic";
                          column: string | null;
                          maxValues: number;
                        }) | {
                          /** @constant */
                          dimensionType: "static";
                          column: string;
                          values: (string)[];
                        } | ({
                          /** @constant */
                          dimensionType: "slice";
                          slices: ({
                              name: string;
                              filters: ({
                                  /** @enum {string} */
                                  operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                  column?: string;
                                  values?: (string)[];
                                })[];
                            })[];
                        }))[];
                      /** @enum {string} */
                      chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                      dateRange: {
                        /** @enum {string} */
                        predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                        lookbackValue?: number | null;
                        lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                        startDate?: string | null;
                        endDate?: string | null;
                      };
                      /** @constant */
                      type: "metric";
                      dataset: {
                        /** @constant */
                        type: "metric";
                        values: ({
                            name: string;
                            rowFilters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                            /** @constant */
                            type: "metric";
                            metricId: string;
                            unit: string | null;
                            denominatorUnit: string | null;
                          })[];
                      };
                    };
                  }) | ({
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "fact-table-exploration";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    explorerAnalysisId: string;
                    config: {
                      /** @description ID of the datasource to query */
                      datasource: string;
                      dimensions: (({
                          /** @constant */
                          dimensionType: "date";
                          column: string | null;
                          /** @enum {string} */
                          dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                        }) | ({
                          /** @constant */
                          dimensionType: "dynamic";
                          column: string | null;
                          maxValues: number;
                        }) | {
                          /** @constant */
                          dimensionType: "static";
                          column: string;
                          values: (string)[];
                        } | ({
                          /** @constant */
                          dimensionType: "slice";
                          slices: ({
                              name: string;
                              filters: ({
                                  /** @enum {string} */
                                  operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                  column?: string;
                                  values?: (string)[];
                                })[];
                            })[];
                        }))[];
                      /** @enum {string} */
                      chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                      dateRange: {
                        /** @enum {string} */
                        predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                        lookbackValue?: number | null;
                        lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                        startDate?: string | null;
                        endDate?: string | null;
                      };
                      /** @constant */
                      type: "fact_table";
                      dataset: {
                        /** @constant */
                        type: "fact_table";
                        factTableId: string | null;
                        values: ({
                            name: string;
                            rowFilters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                            /** @constant */
                            type: "fact_table";
                            /** @enum {string} */
                            valueType: "unit_count" | "count" | "sum";
                            valueColumn: string | null;
                            unit: string | null;
                          })[];
                      };
                    };
                  }) | ({
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "data-source-exploration";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    explorerAnalysisId: string;
                    config: {
                      /** @description ID of the datasource to query */
                      datasource: string;
                      dimensions: (({
                          /** @constant */
                          dimensionType: "date";
                          column: string | null;
                          /** @enum {string} */
                          dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                        }) | ({
                          /** @constant */
                          dimensionType: "dynamic";
                          column: string | null;
                          maxValues: number;
                        }) | {
                          /** @constant */
                          dimensionType: "static";
                          column: string;
                          values: (string)[];
                        } | ({
                          /** @constant */
                          dimensionType: "slice";
                          slices: ({
                              name: string;
                              filters: ({
                                  /** @enum {string} */
                                  operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                  column?: string;
                                  values?: (string)[];
                                })[];
                            })[];
                        }))[];
                      /** @enum {string} */
                      chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                      dateRange: {
                        /** @enum {string} */
                        predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                        lookbackValue?: number | null;
                        lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                        startDate?: string | null;
                        endDate?: string | null;
                      };
                      /** @constant */
                      type: "data_source";
                      dataset: {
                        /** @constant */
                        type: "data_source";
                        table: string;
                        path: string;
                        timestampColumn: string;
                        columnTypes: {
                          [key: string]: ("string" | "number" | "date" | "boolean" | "other") | undefined;
                        };
                        values: ({
                            name: string;
                            rowFilters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                            /** @constant */
                            type: "data_source";
                            /** @enum {string} */
                            valueType: "unit_count" | "count" | "sum";
                            valueColumn: string | null;
                            unit: string | null;
                          })[];
                      };
                    };
                  }))[];
              })[];
          };
        };
      };
    };
  };
  createDashboard: {
    /** Create a single dashboard */
    requestBody: {
      content: {
        "application/json": {
          /** @description The display name of the Dashboard */
          title: string;
          /**
           * @description Dashboards that are "published" are editable by organization members with appropriate permissions 
           * @enum {string}
           */
          editLevel: "published" | "private";
          /**
           * @description General Dashboards only. Dashboards that are "published" are viewable by organization members with appropriate permissions 
           * @enum {string}
           */
          shareLevel: "published" | "private";
          /** @description If enabled for a General Dashboard, also requires an updateSchedule */
          enableAutoUpdates: boolean;
          /** @description General Dashboards only. Experiment Dashboards update based on the parent experiment instead */
          updateSchedule?: {
            /** @constant */
            type: "stale";
            hours: number;
          } | {
            /** @constant */
            type: "cron";
            cron: string;
          };
          /** @description The parent experiment for an Experiment Dashboard, or undefined for a general dashboard */
          experimentId?: string;
          /** @description General Dashboards only, Experiment Dashboards use the experiment's projects */
          projects?: (string)[];
          blocks: ({
              /** @constant */
              type: "markdown";
              title: string;
              description: string;
              snapshotId?: string;
              content: string;
            } | {
              /** @constant */
              type: "experiment-metadata";
              title: string;
              description: string;
              snapshotId?: string;
              experimentId: string;
              showDescription: boolean;
              showHypothesis: boolean;
              showVariationImages: boolean;
              variationIds?: (string)[];
            } | ({
              /** @constant */
              type: "experiment-metric";
              title: string;
              description: string;
              snapshotId: string;
              experimentId: string;
              metricIds: (string)[];
              variationIds: (string)[];
              baselineRow: number;
              /** @enum {string} */
              differenceType: "absolute" | "relative" | "scaled";
              columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
              sliceTagsFilter: (string)[];
              metricTagFilter: (string)[];
              sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
              sortDirection: ("asc" | "desc") | null;
            }) | ({
              /** @constant */
              type: "experiment-dimension";
              title: string;
              description: string;
              snapshotId: string;
              experimentId: string;
              dimensionId: string;
              dimensionValues: (string)[];
              metricIds: (string)[];
              variationIds: (string)[];
              baselineRow: number;
              /** @enum {string} */
              differenceType: "absolute" | "relative" | "scaled";
              columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
              metricTagFilter: (string)[];
              sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
              sortDirection: ("asc" | "desc") | null;
            }) | ({
              /** @constant */
              type: "experiment-time-series";
              title: string;
              description: string;
              snapshotId: string;
              experimentId: string;
              metricId?: string;
              metricIds: (string)[];
              variationIds: (string)[];
              /** @enum {string} */
              differenceType: "absolute" | "relative" | "scaled";
              sliceTagsFilter: (string)[];
              metricTagFilter: (string)[];
              sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
              sortDirection: ("asc" | "desc") | null;
            }) | {
              /** @constant */
              type: "experiment-traffic";
              title: string;
              description: string;
              snapshotId?: string;
              experimentId: string;
              showTable: boolean;
              showTimeseries: boolean;
            } | {
              /** @constant */
              type: "sql-explorer";
              title: string;
              description: string;
              snapshotId?: string;
              savedQueryId: string;
              dataVizConfigIndex?: number;
              blockConfig: (string)[];
            } | ({
              /** @constant */
              type: "metric-explorer";
              title: string;
              description: string;
              snapshotId?: string;
              factMetricId: string;
              /** @enum {string} */
              visualizationType: "histogram" | "bigNumber" | "timeseries";
              /** @enum {string} */
              valueType: "avg" | "sum";
              metricAnalysisId: string;
              analysisSettings: {
                userIdType: string;
                lookbackDays: number;
                /** @enum {string} */
                populationType: "metric" | "factTable" | "exposureQuery" | "population" | "segment";
                populationId: string | null;
                additionalNumeratorFilters?: (string)[];
                additionalDenominatorFilters?: (string)[];
                startDate: string;
                endDate: string;
              };
            }))[];
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            dashboard: {
              id: string;
              uid: string;
              organization: string;
              experimentId?: string;
              isDefault: boolean;
              isDeleted: boolean;
              userId: string;
              /** @enum {string} */
              editLevel: "published" | "private";
              /** @enum {string} */
              shareLevel: "published" | "private";
              enableAutoUpdates: boolean;
              updateSchedule?: {
                /** @constant */
                type: "stale";
                hours: number;
              } | {
                /** @constant */
                type: "cron";
                cron: string;
              };
              title: string;
              projects?: (string)[];
              /** Format: date-time */
              nextUpdate?: string;
              /** Format: date-time */
              lastUpdated?: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              blocks: (({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "metric-explorer";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  factMetricId: string;
                  /** @enum {string} */
                  visualizationType: "histogram" | "bigNumber" | "timeseries";
                  /** @enum {string} */
                  valueType: "avg" | "sum";
                  metricAnalysisId: string;
                  analysisSettings: {
                    userIdType: string;
                    lookbackDays: number;
                    /** @enum {string} */
                    populationType: "metric" | "factTable" | "exposureQuery" | "population" | "segment";
                    populationId: string | null;
                    additionalNumeratorFilters?: (string)[];
                    additionalDenominatorFilters?: (string)[];
                    startDate: string;
                    endDate: string;
                  };
                }) | {
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "markdown";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  content: string;
                } | {
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-metadata";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  experimentId: string;
                  showDescription: boolean;
                  showHypothesis: boolean;
                  showVariationImages: boolean;
                  variationIds?: (string)[];
                } | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-metric";
                  title: string;
                  description: string;
                  snapshotId: string;
                  experimentId: string;
                  metricIds: (string)[];
                  variationIds: (string)[];
                  baselineRow: number;
                  /** @enum {string} */
                  differenceType: "absolute" | "relative" | "scaled";
                  columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
                  sliceTagsFilter: (string)[];
                  metricTagFilter: (string)[];
                  sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                  sortDirection: ("asc" | "desc") | null;
                }) | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-dimension";
                  title: string;
                  description: string;
                  snapshotId: string;
                  experimentId: string;
                  dimensionId: string;
                  dimensionValues: (string)[];
                  metricIds: (string)[];
                  variationIds: (string)[];
                  baselineRow: number;
                  /** @enum {string} */
                  differenceType: "absolute" | "relative" | "scaled";
                  columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
                  metricTagFilter: (string)[];
                  sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                  sortDirection: ("asc" | "desc") | null;
                }) | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-time-series";
                  title: string;
                  description: string;
                  snapshotId: string;
                  experimentId: string;
                  metricId?: string;
                  metricIds: (string)[];
                  variationIds: (string)[];
                  /** @enum {string} */
                  differenceType: "absolute" | "relative" | "scaled";
                  sliceTagsFilter: (string)[];
                  metricTagFilter: (string)[];
                  sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                  sortDirection: ("asc" | "desc") | null;
                }) | {
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "experiment-traffic";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  experimentId: string;
                  showTable: boolean;
                  showTimeseries: boolean;
                } | {
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "sql-explorer";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  savedQueryId: string;
                  dataVizConfigIndex?: number;
                  blockConfig: (string)[];
                } | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "metric-exploration";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  explorerAnalysisId: string;
                  config: {
                    /** @description ID of the datasource to query */
                    datasource: string;
                    dimensions: (({
                        /** @constant */
                        dimensionType: "date";
                        column: string | null;
                        /** @enum {string} */
                        dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                      }) | ({
                        /** @constant */
                        dimensionType: "dynamic";
                        column: string | null;
                        maxValues: number;
                      }) | {
                        /** @constant */
                        dimensionType: "static";
                        column: string;
                        values: (string)[];
                      } | ({
                        /** @constant */
                        dimensionType: "slice";
                        slices: ({
                            name: string;
                            filters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                          })[];
                      }))[];
                    /** @enum {string} */
                    chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                    dateRange: {
                      /** @enum {string} */
                      predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                      lookbackValue?: number | null;
                      lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                      startDate?: string | null;
                      endDate?: string | null;
                    };
                    /** @constant */
                    type: "metric";
                    dataset: {
                      /** @constant */
                      type: "metric";
                      values: ({
                          name: string;
                          rowFilters: ({
                              /** @enum {string} */
                              operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                              column?: string;
                              values?: (string)[];
                            })[];
                          /** @constant */
                          type: "metric";
                          metricId: string;
                          unit: string | null;
                          denominatorUnit: string | null;
                        })[];
                    };
                  };
                }) | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "fact-table-exploration";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  explorerAnalysisId: string;
                  config: {
                    /** @description ID of the datasource to query */
                    datasource: string;
                    dimensions: (({
                        /** @constant */
                        dimensionType: "date";
                        column: string | null;
                        /** @enum {string} */
                        dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                      }) | ({
                        /** @constant */
                        dimensionType: "dynamic";
                        column: string | null;
                        maxValues: number;
                      }) | {
                        /** @constant */
                        dimensionType: "static";
                        column: string;
                        values: (string)[];
                      } | ({
                        /** @constant */
                        dimensionType: "slice";
                        slices: ({
                            name: string;
                            filters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                          })[];
                      }))[];
                    /** @enum {string} */
                    chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                    dateRange: {
                      /** @enum {string} */
                      predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                      lookbackValue?: number | null;
                      lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                      startDate?: string | null;
                      endDate?: string | null;
                    };
                    /** @constant */
                    type: "fact_table";
                    dataset: {
                      /** @constant */
                      type: "fact_table";
                      factTableId: string | null;
                      values: ({
                          name: string;
                          rowFilters: ({
                              /** @enum {string} */
                              operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                              column?: string;
                              values?: (string)[];
                            })[];
                          /** @constant */
                          type: "fact_table";
                          /** @enum {string} */
                          valueType: "unit_count" | "count" | "sum";
                          valueColumn: string | null;
                          unit: string | null;
                        })[];
                    };
                  };
                }) | ({
                  organization: string;
                  id: string;
                  uid: string;
                  /** @constant */
                  type: "data-source-exploration";
                  title: string;
                  description: string;
                  snapshotId?: string;
                  explorerAnalysisId: string;
                  config: {
                    /** @description ID of the datasource to query */
                    datasource: string;
                    dimensions: (({
                        /** @constant */
                        dimensionType: "date";
                        column: string | null;
                        /** @enum {string} */
                        dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                      }) | ({
                        /** @constant */
                        dimensionType: "dynamic";
                        column: string | null;
                        maxValues: number;
                      }) | {
                        /** @constant */
                        dimensionType: "static";
                        column: string;
                        values: (string)[];
                      } | ({
                        /** @constant */
                        dimensionType: "slice";
                        slices: ({
                            name: string;
                            filters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                          })[];
                      }))[];
                    /** @enum {string} */
                    chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                    dateRange: {
                      /** @enum {string} */
                      predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                      lookbackValue?: number | null;
                      lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                      startDate?: string | null;
                      endDate?: string | null;
                    };
                    /** @constant */
                    type: "data_source";
                    dataset: {
                      /** @constant */
                      type: "data_source";
                      table: string;
                      path: string;
                      timestampColumn: string;
                      columnTypes: {
                        [key: string]: ("string" | "number" | "date" | "boolean" | "other") | undefined;
                      };
                      values: ({
                          name: string;
                          rowFilters: ({
                              /** @enum {string} */
                              operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                              column?: string;
                              values?: (string)[];
                            })[];
                          /** @constant */
                          type: "data_source";
                          /** @enum {string} */
                          valueType: "unit_count" | "count" | "sum";
                          valueColumn: string | null;
                          unit: string | null;
                        })[];
                    };
                  };
                }))[];
            };
          };
        };
      };
    };
  };
  getDashboardsForExperiment: {
    /** Get all dashboards for an experiment */
    parameters: {
      path: {
        experimentId: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            dashboards: ({
                id: string;
                uid: string;
                organization: string;
                experimentId?: string;
                isDefault: boolean;
                isDeleted: boolean;
                userId: string;
                /** @enum {string} */
                editLevel: "published" | "private";
                /** @enum {string} */
                shareLevel: "published" | "private";
                enableAutoUpdates: boolean;
                updateSchedule?: {
                  /** @constant */
                  type: "stale";
                  hours: number;
                } | {
                  /** @constant */
                  type: "cron";
                  cron: string;
                };
                title: string;
                projects?: (string)[];
                /** Format: date-time */
                nextUpdate?: string;
                /** Format: date-time */
                lastUpdated?: string;
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
                blocks: (({
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "metric-explorer";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    factMetricId: string;
                    /** @enum {string} */
                    visualizationType: "histogram" | "bigNumber" | "timeseries";
                    /** @enum {string} */
                    valueType: "avg" | "sum";
                    metricAnalysisId: string;
                    analysisSettings: {
                      userIdType: string;
                      lookbackDays: number;
                      /** @enum {string} */
                      populationType: "metric" | "factTable" | "exposureQuery" | "population" | "segment";
                      populationId: string | null;
                      additionalNumeratorFilters?: (string)[];
                      additionalDenominatorFilters?: (string)[];
                      startDate: string;
                      endDate: string;
                    };
                  }) | {
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "markdown";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    content: string;
                  } | {
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "experiment-metadata";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    experimentId: string;
                    showDescription: boolean;
                    showHypothesis: boolean;
                    showVariationImages: boolean;
                    variationIds?: (string)[];
                  } | ({
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "experiment-metric";
                    title: string;
                    description: string;
                    snapshotId: string;
                    experimentId: string;
                    metricIds: (string)[];
                    variationIds: (string)[];
                    baselineRow: number;
                    /** @enum {string} */
                    differenceType: "absolute" | "relative" | "scaled";
                    columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
                    sliceTagsFilter: (string)[];
                    metricTagFilter: (string)[];
                    sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                    sortDirection: ("asc" | "desc") | null;
                  }) | ({
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "experiment-dimension";
                    title: string;
                    description: string;
                    snapshotId: string;
                    experimentId: string;
                    dimensionId: string;
                    dimensionValues: (string)[];
                    metricIds: (string)[];
                    variationIds: (string)[];
                    baselineRow: number;
                    /** @enum {string} */
                    differenceType: "absolute" | "relative" | "scaled";
                    columnsFilter: (("Metric & Variation Names") | "Baseline Average" | "Variation Averages" | "Chance to Win" | "CI Graph" | "Lift")[];
                    metricTagFilter: (string)[];
                    sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                    sortDirection: ("asc" | "desc") | null;
                  }) | ({
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "experiment-time-series";
                    title: string;
                    description: string;
                    snapshotId: string;
                    experimentId: string;
                    metricId?: string;
                    metricIds: (string)[];
                    variationIds: (string)[];
                    /** @enum {string} */
                    differenceType: "absolute" | "relative" | "scaled";
                    sliceTagsFilter: (string)[];
                    metricTagFilter: (string)[];
                    sortBy: ("metrics" | "metricTags" | "significance" | "change") | null;
                    sortDirection: ("asc" | "desc") | null;
                  }) | {
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "experiment-traffic";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    experimentId: string;
                    showTable: boolean;
                    showTimeseries: boolean;
                  } | {
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "sql-explorer";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    savedQueryId: string;
                    dataVizConfigIndex?: number;
                    blockConfig: (string)[];
                  } | ({
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "metric-exploration";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    explorerAnalysisId: string;
                    config: {
                      /** @description ID of the datasource to query */
                      datasource: string;
                      dimensions: (({
                          /** @constant */
                          dimensionType: "date";
                          column: string | null;
                          /** @enum {string} */
                          dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                        }) | ({
                          /** @constant */
                          dimensionType: "dynamic";
                          column: string | null;
                          maxValues: number;
                        }) | {
                          /** @constant */
                          dimensionType: "static";
                          column: string;
                          values: (string)[];
                        } | ({
                          /** @constant */
                          dimensionType: "slice";
                          slices: ({
                              name: string;
                              filters: ({
                                  /** @enum {string} */
                                  operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                  column?: string;
                                  values?: (string)[];
                                })[];
                            })[];
                        }))[];
                      /** @enum {string} */
                      chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                      dateRange: {
                        /** @enum {string} */
                        predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                        lookbackValue?: number | null;
                        lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                        startDate?: string | null;
                        endDate?: string | null;
                      };
                      /** @constant */
                      type: "metric";
                      dataset: {
                        /** @constant */
                        type: "metric";
                        values: ({
                            name: string;
                            rowFilters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                            /** @constant */
                            type: "metric";
                            metricId: string;
                            unit: string | null;
                            denominatorUnit: string | null;
                          })[];
                      };
                    };
                  }) | ({
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "fact-table-exploration";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    explorerAnalysisId: string;
                    config: {
                      /** @description ID of the datasource to query */
                      datasource: string;
                      dimensions: (({
                          /** @constant */
                          dimensionType: "date";
                          column: string | null;
                          /** @enum {string} */
                          dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                        }) | ({
                          /** @constant */
                          dimensionType: "dynamic";
                          column: string | null;
                          maxValues: number;
                        }) | {
                          /** @constant */
                          dimensionType: "static";
                          column: string;
                          values: (string)[];
                        } | ({
                          /** @constant */
                          dimensionType: "slice";
                          slices: ({
                              name: string;
                              filters: ({
                                  /** @enum {string} */
                                  operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                  column?: string;
                                  values?: (string)[];
                                })[];
                            })[];
                        }))[];
                      /** @enum {string} */
                      chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                      dateRange: {
                        /** @enum {string} */
                        predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                        lookbackValue?: number | null;
                        lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                        startDate?: string | null;
                        endDate?: string | null;
                      };
                      /** @constant */
                      type: "fact_table";
                      dataset: {
                        /** @constant */
                        type: "fact_table";
                        factTableId: string | null;
                        values: ({
                            name: string;
                            rowFilters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                            /** @constant */
                            type: "fact_table";
                            /** @enum {string} */
                            valueType: "unit_count" | "count" | "sum";
                            valueColumn: string | null;
                            unit: string | null;
                          })[];
                      };
                    };
                  }) | ({
                    organization: string;
                    id: string;
                    uid: string;
                    /** @constant */
                    type: "data-source-exploration";
                    title: string;
                    description: string;
                    snapshotId?: string;
                    explorerAnalysisId: string;
                    config: {
                      /** @description ID of the datasource to query */
                      datasource: string;
                      dimensions: (({
                          /** @constant */
                          dimensionType: "date";
                          column: string | null;
                          /** @enum {string} */
                          dateGranularity: "auto" | "hour" | "day" | "week" | "month" | "year";
                        }) | ({
                          /** @constant */
                          dimensionType: "dynamic";
                          column: string | null;
                          maxValues: number;
                        }) | {
                          /** @constant */
                          dimensionType: "static";
                          column: string;
                          values: (string)[];
                        } | ({
                          /** @constant */
                          dimensionType: "slice";
                          slices: ({
                              name: string;
                              filters: ({
                                  /** @enum {string} */
                                  operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                  column?: string;
                                  values?: (string)[];
                                })[];
                            })[];
                        }))[];
                      /** @enum {string} */
                      chartType: "line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber";
                      dateRange: {
                        /** @enum {string} */
                        predefined: "today" | "last7Days" | "last30Days" | "last90Days" | "customLookback" | "customDateRange";
                        lookbackValue?: number | null;
                        lookbackUnit?: ("hour" | "day" | "week" | "month") | null;
                        startDate?: string | null;
                        endDate?: string | null;
                      };
                      /** @constant */
                      type: "data_source";
                      dataset: {
                        /** @constant */
                        type: "data_source";
                        table: string;
                        path: string;
                        timestampColumn: string;
                        columnTypes: {
                          [key: string]: ("string" | "number" | "date" | "boolean" | "other") | undefined;
                        };
                        values: ({
                            name: string;
                            rowFilters: ({
                                /** @enum {string} */
                                operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not_in" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_null" | "not_null" | "is_true" | "is_false" | "sql_expr" | "saved_filter";
                                column?: string;
                                values?: (string)[];
                              })[];
                            /** @constant */
                            type: "data_source";
                            /** @enum {string} */
                            valueType: "unit_count" | "count" | "sum";
                            valueColumn: string | null;
                            unit: string | null;
                          })[];
                      };
                    };
                  }))[];
              })[];
          };
        };
      };
    };
  };
  getExperimentTemplate: {
    /** Get a single experimentTemplate */
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            experimentTemplate: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              project?: string;
              /** @description The userId of the owner (or raw owner name/email for legacy records) */
              owner: string;
              templateMetadata: {
                name: string;
                description?: string;
              };
              /** @enum {string} */
              type: "standard";
              hypothesis?: string;
              description?: string;
              tags?: (string)[];
              customFields?: {
                [key: string]: string | undefined;
              };
              datasource: string;
              exposureQueryId: string;
              hashAttribute?: string;
              fallbackAttribute?: string;
              disableStickyBucketing?: boolean;
              goalMetrics?: (string)[];
              secondaryMetrics?: (string)[];
              guardrailMetrics?: (string)[];
              activationMetric?: string;
              /** @enum {string} */
              statsEngine: "bayesian" | "frequentist";
              segment?: string;
              skipPartialData?: boolean;
              targeting: {
                coverage: number;
                savedGroups?: ({
                    /** @enum {string} */
                    match: "all" | "none" | "any";
                    ids: (string)[];
                  })[];
                prerequisites?: ({
                    id: string;
                    condition: string;
                  })[];
                condition: string;
              };
              customMetricSlices?: ({
                  slices: ({
                      column: string;
                      levels: (string)[];
                    })[];
                })[];
            };
          };
        };
      };
    };
  };
  updateExperimentTemplate: {
    /** Update a single experimentTemplate */
    parameters: {
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          project?: string;
          templateMetadata?: {
            name: string;
            description?: string;
          };
          /** @enum {string} */
          type?: "standard";
          hypothesis?: string;
          description?: string;
          tags?: (string)[];
          customFields?: {
            [key: string]: string | undefined;
          };
          datasource?: string;
          exposureQueryId?: string;
          hashAttribute?: string;
          fallbackAttribute?: string;
          disableStickyBucketing?: boolean;
          goalMetrics?: (string)[];
          secondaryMetrics?: (string)[];
          guardrailMetrics?: (string)[];
          activationMetric?: string;
          /** @enum {string} */
          statsEngine?: "bayesian" | "frequentist";
          segment?: string;
          skipPartialData?: boolean;
          targeting?: {
            coverage: number;
            savedGroups?: ({
                /** @enum {string} */
                match: "all" | "none" | "any";
                ids: (string)[];
              })[];
            prerequisites?: ({
                id: string;
                condition: string;
              })[];
            condition: string;
          };
          customMetricSlices?: ({
              slices: ({
                  column: string;
                  levels: (string)[];
                })[];
            })[];
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            experimentTemplate: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              project?: string;
              /** @description The userId of the owner (or raw owner name/email for legacy records) */
              owner: string;
              templateMetadata: {
                name: string;
                description?: string;
              };
              /** @enum {string} */
              type: "standard";
              hypothesis?: string;
              description?: string;
              tags?: (string)[];
              customFields?: {
                [key: string]: string | undefined;
              };
              datasource: string;
              exposureQueryId: string;
              hashAttribute?: string;
              fallbackAttribute?: string;
              disableStickyBucketing?: boolean;
              goalMetrics?: (string)[];
              secondaryMetrics?: (string)[];
              guardrailMetrics?: (string)[];
              activationMetric?: string;
              /** @enum {string} */
              statsEngine: "bayesian" | "frequentist";
              segment?: string;
              skipPartialData?: boolean;
              targeting: {
                coverage: number;
                savedGroups?: ({
                    /** @enum {string} */
                    match: "all" | "none" | "any";
                    ids: (string)[];
                  })[];
                prerequisites?: ({
                    id: string;
                    condition: string;
                  })[];
                condition: string;
              };
              customMetricSlices?: ({
                  slices: ({
                      column: string;
                      levels: (string)[];
                    })[];
                })[];
            };
          };
        };
      };
    };
  };
  deleteExperimentTemplate: {
    /** Delete a single experimentTemplate */
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            deletedId: string;
          };
        };
      };
    };
  };
  listExperimentTemplates: {
    /** Get all experimentTemplates */
    parameters: {
      query: {
        projectId?: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            experimentTemplates: ({
                id: string;
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
                project?: string;
                /** @description The userId of the owner (or raw owner name/email for legacy records) */
                owner: string;
                templateMetadata: {
                  name: string;
                  description?: string;
                };
                /** @enum {string} */
                type: "standard";
                hypothesis?: string;
                description?: string;
                tags?: (string)[];
                customFields?: {
                  [key: string]: string | undefined;
                };
                datasource: string;
                exposureQueryId: string;
                hashAttribute?: string;
                fallbackAttribute?: string;
                disableStickyBucketing?: boolean;
                goalMetrics?: (string)[];
                secondaryMetrics?: (string)[];
                guardrailMetrics?: (string)[];
                activationMetric?: string;
                /** @enum {string} */
                statsEngine: "bayesian" | "frequentist";
                segment?: string;
                skipPartialData?: boolean;
                targeting: {
                  coverage: number;
                  savedGroups?: ({
                      /** @enum {string} */
                      match: "all" | "none" | "any";
                      ids: (string)[];
                    })[];
                  prerequisites?: ({
                      id: string;
                      condition: string;
                    })[];
                  condition: string;
                };
                customMetricSlices?: ({
                    slices: ({
                        column: string;
                        levels: (string)[];
                      })[];
                  })[];
              })[];
          };
        };
      };
    };
  };
  createExperimentTemplate: {
    /** Create a single experimentTemplate */
    requestBody: {
      content: {
        "application/json": {
          project?: string;
          templateMetadata: {
            name: string;
            description?: string;
          };
          /** @enum {string} */
          type: "standard";
          hypothesis?: string;
          description?: string;
          tags?: (string)[];
          customFields?: {
            [key: string]: string | undefined;
          };
          datasource: string;
          exposureQueryId: string;
          hashAttribute?: string;
          fallbackAttribute?: string;
          disableStickyBucketing?: boolean;
          goalMetrics?: (string)[];
          secondaryMetrics?: (string)[];
          guardrailMetrics?: (string)[];
          activationMetric?: string;
          /** @enum {string} */
          statsEngine: "bayesian" | "frequentist";
          segment?: string;
          skipPartialData?: boolean;
          targeting: {
            coverage: number;
            savedGroups?: ({
                /** @enum {string} */
                match: "all" | "none" | "any";
                ids: (string)[];
              })[];
            prerequisites?: ({
                id: string;
                condition: string;
              })[];
            condition: string;
          };
          customMetricSlices?: ({
              slices: ({
                  column: string;
                  levels: (string)[];
                })[];
            })[];
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            experimentTemplate: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              project?: string;
              /** @description The userId of the owner (or raw owner name/email for legacy records) */
              owner: string;
              templateMetadata: {
                name: string;
                description?: string;
              };
              /** @enum {string} */
              type: "standard";
              hypothesis?: string;
              description?: string;
              tags?: (string)[];
              customFields?: {
                [key: string]: string | undefined;
              };
              datasource: string;
              exposureQueryId: string;
              hashAttribute?: string;
              fallbackAttribute?: string;
              disableStickyBucketing?: boolean;
              goalMetrics?: (string)[];
              secondaryMetrics?: (string)[];
              guardrailMetrics?: (string)[];
              activationMetric?: string;
              /** @enum {string} */
              statsEngine: "bayesian" | "frequentist";
              segment?: string;
              skipPartialData?: boolean;
              targeting: {
                coverage: number;
                savedGroups?: ({
                    /** @enum {string} */
                    match: "all" | "none" | "any";
                    ids: (string)[];
                  })[];
                prerequisites?: ({
                    id: string;
                    condition: string;
                  })[];
                condition: string;
              };
              customMetricSlices?: ({
                  slices: ({
                      column: string;
                      levels: (string)[];
                    })[];
                })[];
            };
          };
        };
      };
    };
  };
  bulkImportExperimentTemplates: {
    /** Bulk create or update experiment templates */
    requestBody: {
      content: {
        "application/json": {
          templates: ({
              id: string;
              data: {
                project?: string;
                templateMetadata: {
                  name: string;
                  description?: string;
                };
                /** @enum {string} */
                type: "standard";
                hypothesis?: string;
                description?: string;
                tags?: (string)[];
                customFields?: {
                  [key: string]: string | undefined;
                };
                datasource: string;
                exposureQueryId: string;
                hashAttribute?: string;
                fallbackAttribute?: string;
                disableStickyBucketing?: boolean;
                goalMetrics?: (string)[];
                secondaryMetrics?: (string)[];
                guardrailMetrics?: (string)[];
                activationMetric?: string;
                /** @enum {string} */
                statsEngine: "bayesian" | "frequentist";
                segment?: string;
                skipPartialData?: boolean;
                targeting: {
                  coverage: number;
                  savedGroups?: ({
                      /** @enum {string} */
                      match: "all" | "none" | "any";
                      ids: (string)[];
                    })[];
                  prerequisites?: ({
                      id: string;
                      condition: string;
                    })[];
                  condition: string;
                };
                customMetricSlices?: ({
                    slices: ({
                        column: string;
                        levels: (string)[];
                      })[];
                  })[];
              };
            })[];
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            added: number;
            updated: number;
          };
        };
      };
    };
  };
  getMetricGroup: {
    /** Get a single metricGroup */
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            metricGroup: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              /** @description The userId of the owner (or raw owner name/email for legacy records) */
              owner: string;
              name: string;
              description: string;
              tags: (string)[];
              projects: (string)[];
              metrics: (string)[];
              datasource: string;
              archived: boolean;
            };
          };
        };
      };
    };
  };
  updateMetricGroup: {
    /** Update a single metricGroup */
    parameters: {
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          name?: string;
          description?: string;
          tags?: (string)[];
          projects?: (string)[];
          metrics?: (string)[];
          datasource?: string;
          /** @description The userId or email address of the owner. If an email address is provided, it will be used to look up the userId of the matching organization member. If an ID is provided, it will be validated as existing in the organization. */
          owner?: string;
          archived?: boolean;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            metricGroup: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              /** @description The userId of the owner (or raw owner name/email for legacy records) */
              owner: string;
              name: string;
              description: string;
              tags: (string)[];
              projects: (string)[];
              metrics: (string)[];
              datasource: string;
              archived: boolean;
            };
          };
        };
      };
    };
  };
  deleteMetricGroup: {
    /** Delete a single metricGroup */
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            deletedId: string;
          };
        };
      };
    };
  };
  listMetricGroups: {
    /** Get all metricGroups */
    responses: {
      200: {
        content: {
          "application/json": {
            metricGroups: ({
                id: string;
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
                /** @description The userId of the owner (or raw owner name/email for legacy records) */
                owner: string;
                name: string;
                description: string;
                tags: (string)[];
                projects: (string)[];
                metrics: (string)[];
                datasource: string;
                archived: boolean;
              })[];
          };
        };
      };
    };
  };
  createMetricGroup: {
    /** Create a single metricGroup */
    requestBody: {
      content: {
        "application/json": {
          name: string;
          description: string;
          tags?: (string)[];
          projects: (string)[];
          metrics: (string)[];
          datasource: string;
          /** @description The userId or email address of the owner. If an email address is provided, it will be used to look up the userId of the matching organization member. If an ID is provided, it will be validated as existing in the organization. */
          owner?: string;
          archived?: boolean;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            metricGroup: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              /** @description The userId of the owner (or raw owner name/email for legacy records) */
              owner: string;
              name: string;
              description: string;
              tags: (string)[];
              projects: (string)[];
              metrics: (string)[];
              datasource: string;
              archived: boolean;
            };
          };
        };
      };
    };
  };
  getRampScheduleTemplate: {
    /** Get a single rampScheduleTemplate */
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            rampScheduleTemplate: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              steps: ({
                  trigger: {
                    /** @constant */
                    type: "interval";
                    seconds: number;
                  } | {
                    /** @constant */
                    type: "approval";
                  } | {
                    /** @constant */
                    type: "scheduled";
                    /** Format: date-time */
                    at: string;
                  };
                  actions: ({
                      /** @constant */
                      targetType: "feature-rule";
                      targetId: string;
                      patch: {
                        ruleId: string;
                        coverage?: number | null;
                        condition?: string | null;
                        savedGroups?: (({
                            /** @enum {string} */
                            match: "all" | "none" | "any";
                            ids: (string)[];
                          })[]) | null;
                        prerequisites?: ({
                            id: string;
                            condition: string;
                          })[] | null;
                        enabled?: boolean | null;
                      };
                    })[];
                  approvalNotes?: string | null;
                })[];
              endPatch?: {
                coverage?: number;
                condition?: string;
                savedGroups?: ({
                    /** @enum {string} */
                    match: "all" | "none" | "any";
                    ids: (string)[];
                  })[];
                prerequisites?: ({
                    id: string;
                    condition: string;
                  })[];
              };
              official?: boolean;
            };
          };
        };
      };
    };
  };
  updateRampScheduleTemplate: {
    /** Update a single rampScheduleTemplate */
    parameters: {
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          name?: string;
          steps?: ({
              trigger: {
                /** @constant */
                type: "interval";
                seconds: number;
              } | {
                /** @constant */
                type: "approval";
              } | {
                /** @constant */
                type: "scheduled";
                /** Format: date-time */
                at: string;
              };
              actions: ({
                  /** @constant */
                  targetType: "feature-rule";
                  targetId: string;
                  patch: {
                    ruleId: string;
                    coverage?: number | null;
                    condition?: string | null;
                    savedGroups?: (({
                        /** @enum {string} */
                        match: "all" | "none" | "any";
                        ids: (string)[];
                      })[]) | null;
                    prerequisites?: ({
                        id: string;
                        condition: string;
                      })[] | null;
                    enabled?: boolean | null;
                  };
                })[];
              approvalNotes?: string | null;
            })[];
          endPatch?: {
            coverage?: number;
            condition?: string;
            savedGroups?: ({
                /** @enum {string} */
                match: "all" | "none" | "any";
                ids: (string)[];
              })[];
            prerequisites?: ({
                id: string;
                condition: string;
              })[];
          };
          official?: boolean;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            rampScheduleTemplate: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              steps: ({
                  trigger: {
                    /** @constant */
                    type: "interval";
                    seconds: number;
                  } | {
                    /** @constant */
                    type: "approval";
                  } | {
                    /** @constant */
                    type: "scheduled";
                    /** Format: date-time */
                    at: string;
                  };
                  actions: ({
                      /** @constant */
                      targetType: "feature-rule";
                      targetId: string;
                      patch: {
                        ruleId: string;
                        coverage?: number | null;
                        condition?: string | null;
                        savedGroups?: (({
                            /** @enum {string} */
                            match: "all" | "none" | "any";
                            ids: (string)[];
                          })[]) | null;
                        prerequisites?: ({
                            id: string;
                            condition: string;
                          })[] | null;
                        enabled?: boolean | null;
                      };
                    })[];
                  approvalNotes?: string | null;
                })[];
              endPatch?: {
                coverage?: number;
                condition?: string;
                savedGroups?: ({
                    /** @enum {string} */
                    match: "all" | "none" | "any";
                    ids: (string)[];
                  })[];
                prerequisites?: ({
                    id: string;
                    condition: string;
                  })[];
              };
              official?: boolean;
            };
          };
        };
      };
    };
  };
  deleteRampScheduleTemplate: {
    /** Delete a single rampScheduleTemplate */
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            deletedId: string;
          };
        };
      };
    };
  };
  listRampScheduleTemplates: {
    /** Get all rampScheduleTemplates */
    responses: {
      200: {
        content: {
          "application/json": {
            rampScheduleTemplates: ({
                id: string;
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
                name: string;
                steps: ({
                    trigger: {
                      /** @constant */
                      type: "interval";
                      seconds: number;
                    } | {
                      /** @constant */
                      type: "approval";
                    } | {
                      /** @constant */
                      type: "scheduled";
                      /** Format: date-time */
                      at: string;
                    };
                    actions: ({
                        /** @constant */
                        targetType: "feature-rule";
                        targetId: string;
                        patch: {
                          ruleId: string;
                          coverage?: number | null;
                          condition?: string | null;
                          savedGroups?: (({
                              /** @enum {string} */
                              match: "all" | "none" | "any";
                              ids: (string)[];
                            })[]) | null;
                          prerequisites?: ({
                              id: string;
                              condition: string;
                            })[] | null;
                          enabled?: boolean | null;
                        };
                      })[];
                    approvalNotes?: string | null;
                  })[];
                endPatch?: {
                  coverage?: number;
                  condition?: string;
                  savedGroups?: ({
                      /** @enum {string} */
                      match: "all" | "none" | "any";
                      ids: (string)[];
                    })[];
                  prerequisites?: ({
                      id: string;
                      condition: string;
                    })[];
                };
                official?: boolean;
              })[];
          };
        };
      };
    };
  };
  createRampScheduleTemplate: {
    /** Create a single rampScheduleTemplate */
    requestBody: {
      content: {
        "application/json": {
          name: string;
          steps: ({
              trigger: {
                /** @constant */
                type: "interval";
                seconds: number;
              } | {
                /** @constant */
                type: "approval";
              } | {
                /** @constant */
                type: "scheduled";
                /** Format: date-time */
                at: string;
              };
              actions: ({
                  /** @constant */
                  targetType: "feature-rule";
                  targetId: string;
                  patch: {
                    ruleId: string;
                    coverage?: number | null;
                    condition?: string | null;
                    savedGroups?: (({
                        /** @enum {string} */
                        match: "all" | "none" | "any";
                        ids: (string)[];
                      })[]) | null;
                    prerequisites?: ({
                        id: string;
                        condition: string;
                      })[] | null;
                    enabled?: boolean | null;
                  };
                })[];
              approvalNotes?: string | null;
            })[];
          endPatch?: {
            coverage?: number;
            condition?: string;
            savedGroups?: ({
                /** @enum {string} */
                match: "all" | "none" | "any";
                ids: (string)[];
              })[];
            prerequisites?: ({
                id: string;
                condition: string;
              })[];
          };
          official?: boolean;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            rampScheduleTemplate: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              steps: ({
                  trigger: {
                    /** @constant */
                    type: "interval";
                    seconds: number;
                  } | {
                    /** @constant */
                    type: "approval";
                  } | {
                    /** @constant */
                    type: "scheduled";
                    /** Format: date-time */
                    at: string;
                  };
                  actions: ({
                      /** @constant */
                      targetType: "feature-rule";
                      targetId: string;
                      patch: {
                        ruleId: string;
                        coverage?: number | null;
                        condition?: string | null;
                        savedGroups?: (({
                            /** @enum {string} */
                            match: "all" | "none" | "any";
                            ids: (string)[];
                          })[]) | null;
                        prerequisites?: ({
                            id: string;
                            condition: string;
                          })[] | null;
                        enabled?: boolean | null;
                      };
                    })[];
                  approvalNotes?: string | null;
                })[];
              endPatch?: {
                coverage?: number;
                condition?: string;
                savedGroups?: ({
                    /** @enum {string} */
                    match: "all" | "none" | "any";
                    ids: (string)[];
                  })[];
                prerequisites?: ({
                    id: string;
                    condition: string;
                  })[];
              };
              official?: boolean;
            };
          };
        };
      };
    };
  };
  getRampSchedule: {
    /** Get a single rampSchedule */
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            rampSchedule: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              /** @enum {string} */
              entityType: "feature";
              entityId: string;
              targets: ({
                  id: string;
                  /** @enum {string} */
                  entityType: "feature";
                  entityId: string;
                  ruleId?: string | null;
                  environment?: string | null;
                  /** @enum {string} */
                  status: "pending-join" | "active";
                  activatingRevisionVersion?: number | null;
                })[];
              steps: ({
                  trigger: {
                    /** @constant */
                    type: "interval";
                    seconds: number;
                  } | {
                    /** @constant */
                    type: "approval";
                  } | {
                    /** @constant */
                    type: "scheduled";
                    /** Format: date-time */
                    at: string;
                  };
                  actions: ({
                      /** @constant */
                      targetType: "feature-rule";
                      targetId: string;
                      patch: {
                        ruleId: string;
                        coverage?: number | null;
                        condition?: string | null;
                        savedGroups?: (({
                            /** @enum {string} */
                            match: "all" | "none" | "any";
                            ids: (string)[];
                          })[]) | null;
                        prerequisites?: ({
                            id: string;
                            condition: string;
                          })[] | null;
                        force?: any;
                        enabled?: boolean | null;
                      };
                    })[];
                  approvalNotes?: string | null;
                })[];
              endActions?: ({
                  /** @constant */
                  targetType: "feature-rule";
                  targetId: string;
                  patch: {
                    ruleId: string;
                    coverage?: number | null;
                    condition?: string | null;
                    savedGroups?: (({
                        /** @enum {string} */
                        match: "all" | "none" | "any";
                        ids: (string)[];
                      })[]) | null;
                    prerequisites?: ({
                        id: string;
                        condition: string;
                      })[] | null;
                    force?: any;
                    enabled?: boolean | null;
                  };
                })[];
              startDate?: string | null;
              endCondition?: {
                trigger?: {
                  /** @constant */
                  type: "scheduled";
                  /** Format: date-time */
                  at: string;
                };
              } | null;
              /** @enum {string} */
              status: "pending" | "ready" | "running" | "paused" | "pending-approval" | "completed" | "rolled-back";
              currentStepIndex: number;
              startedAt?: string | null;
              phaseStartedAt?: string | null;
              pausedAt?: string | null;
              nextStepAt: string | null;
              nextProcessAt?: string | null;
              elapsedMs?: number | null;
            };
          };
        };
      };
    };
  };
  updateRampSchedule: {
    /** Update a single rampSchedule */
    parameters: {
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          name?: string;
          steps?: ({
              trigger: {
                /** @constant */
                type: "interval";
                seconds: number;
              } | {
                /** @constant */
                type: "approval";
              } | {
                /** @constant */
                type: "scheduled";
                at: string;
              };
              actions: ({
                  /** @constant */
                  targetType: "feature-rule";
                  patch: {
                    ruleId: string;
                    coverage?: number | null;
                    condition?: string | null;
                    savedGroups?: (({
                        /** @enum {string} */
                        match: "all" | "none" | "any";
                        ids: (string)[];
                      })[]) | null;
                    prerequisites?: ({
                        id: string;
                        condition: string;
                      })[] | null;
                    force?: any;
                    enabled?: boolean | null;
                  };
                  targetId?: string;
                })[];
              approvalNotes?: string | null;
            })[];
          endActions?: ({
              /** @constant */
              targetType: "feature-rule";
              patch: {
                ruleId: string;
                coverage?: number | null;
                condition?: string | null;
                savedGroups?: (({
                    /** @enum {string} */
                    match: "all" | "none" | "any";
                    ids: (string)[];
                  })[]) | null;
                prerequisites?: ({
                    id: string;
                    condition: string;
                  })[] | null;
                force?: any;
                enabled?: boolean | null;
              };
              targetId?: string;
            })[];
          startDate?: string | null;
          endCondition?: {
            trigger?: {
              /** @constant */
              type: "scheduled";
              /** Format: date-time */
              at: string;
            };
          } | null;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            rampSchedule: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              /** @enum {string} */
              entityType: "feature";
              entityId: string;
              targets: ({
                  id: string;
                  /** @enum {string} */
                  entityType: "feature";
                  entityId: string;
                  ruleId?: string | null;
                  environment?: string | null;
                  /** @enum {string} */
                  status: "pending-join" | "active";
                  activatingRevisionVersion?: number | null;
                })[];
              steps: ({
                  trigger: {
                    /** @constant */
                    type: "interval";
                    seconds: number;
                  } | {
                    /** @constant */
                    type: "approval";
                  } | {
                    /** @constant */
                    type: "scheduled";
                    /** Format: date-time */
                    at: string;
                  };
                  actions: ({
                      /** @constant */
                      targetType: "feature-rule";
                      targetId: string;
                      patch: {
                        ruleId: string;
                        coverage?: number | null;
                        condition?: string | null;
                        savedGroups?: (({
                            /** @enum {string} */
                            match: "all" | "none" | "any";
                            ids: (string)[];
                          })[]) | null;
                        prerequisites?: ({
                            id: string;
                            condition: string;
                          })[] | null;
                        force?: any;
                        enabled?: boolean | null;
                      };
                    })[];
                  approvalNotes?: string | null;
                })[];
              endActions?: ({
                  /** @constant */
                  targetType: "feature-rule";
                  targetId: string;
                  patch: {
                    ruleId: string;
                    coverage?: number | null;
                    condition?: string | null;
                    savedGroups?: (({
                        /** @enum {string} */
                        match: "all" | "none" | "any";
                        ids: (string)[];
                      })[]) | null;
                    prerequisites?: ({
                        id: string;
                        condition: string;
                      })[] | null;
                    force?: any;
                    enabled?: boolean | null;
                  };
                })[];
              startDate?: string | null;
              endCondition?: {
                trigger?: {
                  /** @constant */
                  type: "scheduled";
                  /** Format: date-time */
                  at: string;
                };
              } | null;
              /** @enum {string} */
              status: "pending" | "ready" | "running" | "paused" | "pending-approval" | "completed" | "rolled-back";
              currentStepIndex: number;
              startedAt?: string | null;
              phaseStartedAt?: string | null;
              pausedAt?: string | null;
              nextStepAt: string | null;
              nextProcessAt?: string | null;
              elapsedMs?: number | null;
            };
          };
        };
      };
    };
  };
  deleteRampSchedule: {
    /** Delete a single rampSchedule */
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            deletedId: string;
          };
        };
      };
    };
  };
  listRampSchedules: {
    /** Get all rampSchedules */
    parameters: {
      query: {
        featureId?: string;
        status?: string;
        limit: number;
        offset: number;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            rampSchedules: ({
                id: string;
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
                name: string;
                /** @enum {string} */
                entityType: "feature";
                entityId: string;
                targets: ({
                    id: string;
                    /** @enum {string} */
                    entityType: "feature";
                    entityId: string;
                    ruleId?: string | null;
                    environment?: string | null;
                    /** @enum {string} */
                    status: "pending-join" | "active";
                    activatingRevisionVersion?: number | null;
                  })[];
                steps: ({
                    trigger: {
                      /** @constant */
                      type: "interval";
                      seconds: number;
                    } | {
                      /** @constant */
                      type: "approval";
                    } | {
                      /** @constant */
                      type: "scheduled";
                      /** Format: date-time */
                      at: string;
                    };
                    actions: ({
                        /** @constant */
                        targetType: "feature-rule";
                        targetId: string;
                        patch: {
                          ruleId: string;
                          coverage?: number | null;
                          condition?: string | null;
                          savedGroups?: (({
                              /** @enum {string} */
                              match: "all" | "none" | "any";
                              ids: (string)[];
                            })[]) | null;
                          prerequisites?: ({
                              id: string;
                              condition: string;
                            })[] | null;
                          force?: any;
                          enabled?: boolean | null;
                        };
                      })[];
                    approvalNotes?: string | null;
                  })[];
                endActions?: ({
                    /** @constant */
                    targetType: "feature-rule";
                    targetId: string;
                    patch: {
                      ruleId: string;
                      coverage?: number | null;
                      condition?: string | null;
                      savedGroups?: (({
                          /** @enum {string} */
                          match: "all" | "none" | "any";
                          ids: (string)[];
                        })[]) | null;
                      prerequisites?: ({
                          id: string;
                          condition: string;
                        })[] | null;
                      force?: any;
                      enabled?: boolean | null;
                    };
                  })[];
                startDate?: string | null;
                endCondition?: {
                  trigger?: {
                    /** @constant */
                    type: "scheduled";
                    /** Format: date-time */
                    at: string;
                  };
                } | null;
                /** @enum {string} */
                status: "pending" | "ready" | "running" | "paused" | "pending-approval" | "completed" | "rolled-back";
                currentStepIndex: number;
                startedAt?: string | null;
                phaseStartedAt?: string | null;
                pausedAt?: string | null;
                nextStepAt: string | null;
                nextProcessAt?: string | null;
                elapsedMs?: number | null;
              })[];
          };
        };
      };
    };
  };
  createRampSchedule: {
    /** Create a single rampSchedule */
    requestBody: {
      content: {
        "application/json": {
          name: string;
          featureId?: string;
          ruleId?: string;
          environment?: string;
          steps?: ({
              trigger: {
                /** @constant */
                type: "interval";
                seconds: number;
              } | {
                /** @constant */
                type: "approval";
              } | {
                /** @constant */
                type: "scheduled";
                at: string;
              };
              /** @default [] */
              actions: ({
                  /** @constant */
                  targetType?: "feature-rule";
                  targetId?: string;
                  patch: {
                    ruleId?: string;
                    coverage?: number | null;
                    condition?: string | null;
                    savedGroups?: (({
                        /** @enum {string} */
                        match: "all" | "none" | "any";
                        ids: (string)[];
                      })[]) | null;
                    prerequisites?: ({
                        id: string;
                        condition: string;
                      })[] | null;
                    force?: any;
                    enabled?: boolean | null;
                  };
                })[];
              approvalNotes?: string | null;
            })[];
          endActions?: ({
              /** @constant */
              targetType?: "feature-rule";
              targetId?: string;
              patch: {
                ruleId?: string;
                coverage?: number | null;
                condition?: string | null;
                savedGroups?: (({
                    /** @enum {string} */
                    match: "all" | "none" | "any";
                    ids: (string)[];
                  })[]) | null;
                prerequisites?: ({
                    id: string;
                    condition: string;
                  })[] | null;
                force?: any;
                enabled?: boolean | null;
              };
            })[];
          startDate?: string | null;
          endCondition?: {
            trigger?: {
              /** @constant */
              type: "scheduled";
              /** Format: date-time */
              at: string;
            };
          };
          templateId?: string;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            rampSchedule: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              /** @enum {string} */
              entityType: "feature";
              entityId: string;
              targets: ({
                  id: string;
                  /** @enum {string} */
                  entityType: "feature";
                  entityId: string;
                  ruleId?: string | null;
                  environment?: string | null;
                  /** @enum {string} */
                  status: "pending-join" | "active";
                  activatingRevisionVersion?: number | null;
                })[];
              steps: ({
                  trigger: {
                    /** @constant */
                    type: "interval";
                    seconds: number;
                  } | {
                    /** @constant */
                    type: "approval";
                  } | {
                    /** @constant */
                    type: "scheduled";
                    /** Format: date-time */
                    at: string;
                  };
                  actions: ({
                      /** @constant */
                      targetType: "feature-rule";
                      targetId: string;
                      patch: {
                        ruleId: string;
                        coverage?: number | null;
                        condition?: string | null;
                        savedGroups?: (({
                            /** @enum {string} */
                            match: "all" | "none" | "any";
                            ids: (string)[];
                          })[]) | null;
                        prerequisites?: ({
                            id: string;
                            condition: string;
                          })[] | null;
                        force?: any;
                        enabled?: boolean | null;
                      };
                    })[];
                  approvalNotes?: string | null;
                })[];
              endActions?: ({
                  /** @constant */
                  targetType: "feature-rule";
                  targetId: string;
                  patch: {
                    ruleId: string;
                    coverage?: number | null;
                    condition?: string | null;
                    savedGroups?: (({
                        /** @enum {string} */
                        match: "all" | "none" | "any";
                        ids: (string)[];
                      })[]) | null;
                    prerequisites?: ({
                        id: string;
                        condition: string;
                      })[] | null;
                    force?: any;
                    enabled?: boolean | null;
                  };
                })[];
              startDate?: string | null;
              endCondition?: {
                trigger?: {
                  /** @constant */
                  type: "scheduled";
                  /** Format: date-time */
                  at: string;
                };
              } | null;
              /** @enum {string} */
              status: "pending" | "ready" | "running" | "paused" | "pending-approval" | "completed" | "rolled-back";
              currentStepIndex: number;
              startedAt?: string | null;
              phaseStartedAt?: string | null;
              pausedAt?: string | null;
              nextStepAt: string | null;
              nextProcessAt?: string | null;
              elapsedMs?: number | null;
            };
          };
        };
      };
    };
  };
  getTeam: {
    /** Get a single team */
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            team: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              createdBy: string;
              description: string;
              role: string;
              limitAccessByEnvironment: boolean;
              environments: (string)[];
              projectRoles?: ({
                  role: string;
                  limitAccessByEnvironment: boolean;
                  environments: (string)[];
                  teams?: (string)[];
                  project: string;
                })[];
              members: readonly (string)[];
              managedByIdp: boolean;
              managedBy?: {
                /** @constant */
                type: "vercel";
                resourceId: string;
              };
              defaultProject?: string;
            };
          };
        };
      };
    };
  };
  updateTeam: {
    /** Update a single team */
    parameters: {
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          name?: string;
          createdBy?: string;
          description?: string;
          /** @description The global role for members of this team */
          role?: string;
          limitAccessByEnvironment?: boolean;
          /** @description An empty array means 'all environments' */
          environments?: (string)[];
          projectRoles?: ({
              role: string;
              limitAccessByEnvironment: boolean;
              environments: (string)[];
              teams?: (string)[];
              project: string;
            })[];
          managedBy?: {
            /** @constant */
            type: "vercel";
            resourceId: string;
          };
          defaultProject?: string;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            team: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              createdBy: string;
              description: string;
              role: string;
              limitAccessByEnvironment: boolean;
              environments: (string)[];
              projectRoles?: ({
                  role: string;
                  limitAccessByEnvironment: boolean;
                  environments: (string)[];
                  teams?: (string)[];
                  project: string;
                })[];
              members: readonly (string)[];
              managedByIdp: boolean;
              managedBy?: {
                /** @constant */
                type: "vercel";
                resourceId: string;
              };
              defaultProject?: string;
            };
          };
        };
      };
    };
  };
  listTeams: {
    /** Get all teams */
    responses: {
      200: {
        content: {
          "application/json": {
            teams: ({
                id: string;
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
                name: string;
                createdBy: string;
                description: string;
                role: string;
                limitAccessByEnvironment: boolean;
                environments: (string)[];
                projectRoles?: ({
                    role: string;
                    limitAccessByEnvironment: boolean;
                    environments: (string)[];
                    teams?: (string)[];
                    project: string;
                  })[];
                members: readonly (string)[];
                managedByIdp: boolean;
                managedBy?: {
                  /** @constant */
                  type: "vercel";
                  resourceId: string;
                };
                defaultProject?: string;
              })[];
          };
        };
      };
    };
  };
  createTeam: {
    /** Create a single team */
    requestBody: {
      content: {
        "application/json": {
          name: string;
          createdBy?: string;
          description: string;
          /** @description The global role for members of this team */
          role: string;
          limitAccessByEnvironment?: boolean;
          /** @description An empty array means 'all environments' */
          environments?: (string)[];
          projectRoles?: ({
              role: string;
              limitAccessByEnvironment: boolean;
              environments: (string)[];
              teams?: (string)[];
              project: string;
            })[];
          managedBy?: {
            /** @constant */
            type: "vercel";
            resourceId: string;
          };
          defaultProject?: string;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            team: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              createdBy: string;
              description: string;
              role: string;
              limitAccessByEnvironment: boolean;
              environments: (string)[];
              projectRoles?: ({
                  role: string;
                  limitAccessByEnvironment: boolean;
                  environments: (string)[];
                  teams?: (string)[];
                  project: string;
                })[];
              members: readonly (string)[];
              managedByIdp: boolean;
              managedBy?: {
                /** @constant */
                type: "vercel";
                resourceId: string;
              };
              defaultProject?: string;
            };
          };
        };
      };
    };
  };
  addTeamMembers: {
    /** Add members to team */
    parameters: {
      path: {
        teamId: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          members: (string)[];
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            status: number;
          };
        };
      };
    };
  };
  removeTeamMember: {
    /** Remove members from team */
    parameters: {
      path: {
        teamId: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          members: (string)[];
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            status: number;
          };
        };
      };
    };
  };
  deleteTeam: {
    /** Delete a single team */
    parameters: {
      query: {
        deleteMembers?: string;
      };
      path: {
        teamId: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            deletedId: string;
          };
        };
      };
    };
  };
}
import { z } from "zod";
import * as openApiValidators from "shared/validators";

// Schemas

// Operations
