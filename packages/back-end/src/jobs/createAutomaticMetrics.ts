import Agenda, { Job } from "agenda";
import uniqid from "uniqid";
import { getDataSourceById } from "../models/DataSourceModel";
import { insertMetrics } from "../models/MetricModel";
import { MetricInterface, MetricType } from "../../types/metric";
import { getSourceIntegrationObject } from "../services/datasource";
import { getInformationSchemaById } from "../models/InformationSchemaModel";
import { getInformationSchemaTableById } from "../models/InformationSchemaTablesModel";
import { fetchTableData } from "../services/informationSchema";
import { getPath } from "../util/informationSchemas";
import { Column } from "../types/Integration";

const CREATE_AUTOMATIC_METRICS_JOB_NAME = "createAutomaticMetrics";

type CreateAutomaticMetricsJob = Job<{
  organization: string;
  datasourceId: string;
  metricsToCreate: {
    event: string;
    hasUserId: boolean;
    createForUser: boolean;
  }[];
}>;

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  agenda.define(
    CREATE_AUTOMATIC_METRICS_JOB_NAME,
    async (job: CreateAutomaticMetricsJob) => {
      const { datasourceId, organization, metricsToCreate } = job.attrs.data;

      if (!datasourceId || !organization || !metricsToCreate) return;

      const datasource = await getDataSourceById(datasourceId, organization);

      if (!datasource) return;

      const integration = getSourceIntegrationObject(datasource);

      try {
        console.log("made it to the try block");
        const metrics: Partial<MetricInterface>[] = [];
        for (const metric of metricsToCreate) {
          console.log("metric", metric);
          // sampleMetric = {event: "signed_up", hasUserId: true, createForUser: true};
          if (metric.createForUser) {
            // We need to build the SQL query for the metric
            if (!integration.getAutomaticMetricSqlQuery) return; //TODO: Throw an error?
            // But before we can do that, we need to know if the event (aka, the table_name) has a revenue or count column
            // If so, that changes the type, which also affects the query

            // To do that, I need to get the `information_schema_table`'s id, and then get all of the columns for that table.
            const informationSchemaId = datasource.settings.informationSchemaId;
            console.log("informationSchemaId", informationSchemaId);

            if (!informationSchemaId) return; //TODO: Throw an error?

            const informationSchema = await getInformationSchemaById(
              organization,
              informationSchemaId
            );

            console.log("informationSchema", informationSchema);

            if (!informationSchema) return; //TODO: Throw an error?

            let informationSchemaTableId = "";

            informationSchema.databases.forEach((database) => {
              database.schemas.forEach((schema) => {
                schema.tables.forEach((table) => {
                  if (table.tableName === metric.event) {
                    informationSchemaTableId = table.id;
                  }
                });
              });
            });

            console.log("informationSchemaTableId", informationSchemaTableId);

            const informationSchemaTable = await getInformationSchemaTableById(
              organization,
              informationSchemaTableId
            );

            console.log("informationSchemaTable", informationSchemaTable);

            let metricType: MetricType = "binomial";

            if (!informationSchemaTable) {
              // I need to fetch it and set it within Mongo,
              const {
                tableData,
                databaseName,
                tableSchema,
                tableName,
              } = await fetchTableData(
                datasource,
                informationSchema,
                informationSchemaTableId
              );

              if (!tableData) return; //TODO: Throw an error?

              const columns: Column[] = tableData?.map(
                (row: { column_name: string; data_type: string }) => {
                  return {
                    columnName: row.column_name,
                    dataType: row.data_type,
                    path: getPath(datasource.type, {
                      tableCatalog: databaseName,
                      tableSchema: tableSchema,
                      tableName: tableName,
                      columnName: row.column_name,
                    }),
                  };
                }
              );

              if (columns.length) {
                if (columns.some((column) => column.columnName === "revenue")) {
                  metricType = "revenue";
                } else if (
                  columns.some((column) => column.columnName === "count")
                ) {
                  metricType = "count";
                }
              }
            }

            if (informationSchemaTable?.columns.length) {
              if (
                informationSchemaTable.columns.some(
                  (column) => column.columnName === "revenue"
                )
              ) {
                metricType = "revenue";
              } else if (
                informationSchemaTable.columns.some(
                  (column) => column.columnName === "count"
                )
              ) {
                metricType = "count";
              }
            }
            // else {
            //   const { tableData } = await fetchTableData(
            //     datasource,
            //     informationSchema,
            //     informationSchemaTableId
            //   );
            //   if (
            //     tableData?.some(
            //       (column: { data_type: string; column_name: string }) =>
            //         column_name === "revenue"
            //     )
            //   ) {
            //     metricType = "revenue";
            //   } else if (tableData.some((column) => column_name === "count")) {
            //     metricType = "count";
            //   }
            // }

            // From there, I can check if there's a revenue or count column

            // if (tableColumnData?.some((column) => columnName === "revenue")) {
            //   metricType = "revenue";
            // } else if (
            //   tableColumnData?.some((column) => columnName === "count")
            // ) {
            //   metricType = "count";
            // }

            const sqlQuery = integration.getAutomaticMetricSqlQuery(
              metric,
              integration.settings.schemaFormat || "custom"
            );
            metrics.push({
              id: uniqid("met_"),
              organization,
              datasource: datasourceId,
              name: metric.event,
              type: metricType, //TODO: I need to come up with a way to build non-binomial metrics
              sql: sqlQuery,
              dateCreated: new Date(),
              dateUpdated: new Date(),
            });
          }
        }
        await insertMetrics(metrics);
      } catch (e) {
        // Not sure what to do here yet - catch the errors, but what should I do with them?
      }
    }
  );
}

export async function queueCreateAutomaticMetrics(
  datasourceId: string,
  organization: string,
  metricsToCreate: {
    event: string;
    hasUserId: boolean;
    createForUser: boolean;
  }[]
) {
  if (!datasourceId || !organization || !metricsToCreate) return;

  const job = agenda.create(CREATE_AUTOMATIC_METRICS_JOB_NAME, {
    organization,
    datasourceId,
    metricsToCreate,
  }) as CreateAutomaticMetricsJob;
  job.unique({ datasourceId, organization, metricsToCreate });
  job.schedule(new Date());
  await job.save();
}
