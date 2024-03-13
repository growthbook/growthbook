import Agenda, { Job } from "agenda";
import { fetchTableData } from "@/src/services/informationSchema";
import { getContextForAgendaJobByOrgId } from "@/src/services/organizations";
import { trackJob } from "@/src/services/otel";
import { logger } from "@/src/util/logger";
import { getPath } from "@/src/util/informationSchemas";
import { getDataSourceById } from "@/src/models/DataSourceModel";
import { getInformationSchemaById } from "@/src/models/InformationSchemaModel";
import {
  getInformationSchemaTableById,
  updateInformationSchemaTableById,
} from "@/src/models/InformationSchemaTablesModel";
import { Column } from "@/src/types/Integration";

const UPDATE_STALE_INFORMATION_SCHEMA_TABLE_JOB_NAME =
  "updateStaleInformationSchemaTable";
type UpdateStaleInformationSchemaTableJob = Job<{
  organization: string;
  informationSchemaTableId: string;
}>;

const updateStaleInformationSchemaTable = trackJob(
  UPDATE_STALE_INFORMATION_SCHEMA_TABLE_JOB_NAME,
  async (job: UpdateStaleInformationSchemaTableJob) => {
    // console.log("starting the job!");
    const { organization, informationSchemaTableId } = job.attrs.data;

    if (!informationSchemaTableId || !organization) return;

    const informationSchemaTable = await getInformationSchemaTableById(
      organization,
      informationSchemaTableId
    );

    if (!informationSchemaTable) {
      logger.error(
        "Unable to find information schema table in order to refresh stale data: " +
          informationSchemaTableId
      );
      return;
    }

    const context = await getContextForAgendaJobByOrgId(organization);

    const datasource = await getDataSourceById(
      context,
      informationSchemaTable.datasourceId
    );

    const informationSchema = await getInformationSchemaById(
      organization,
      informationSchemaTable.informationSchemaId
    );

    if (!datasource || !informationSchema) {
      logger.error(
        "Unable to find datasource or information schema in order to refresh stale data: " +
          informationSchemaTableId
      );
      return;
    }

    try {
      const { tableData } = await fetchTableData(
        datasource,
        informationSchema,
        informationSchemaTableId
      );

      if (!tableData) {
        logger.error(
          "Unable to fetch table data in order to refresh stale data: " +
            informationSchemaTableId
        );
        return;
      }

      const columns: Column[] = tableData.map(
        (row: { column_name: string; data_type: string }) => {
          return {
            columnName: row.column_name,
            dataType: row.data_type,
            path: getPath(datasource.type, {
              tableCatalog: informationSchemaTable.databaseName,
              tableSchema: informationSchemaTable.tableSchema,
              tableName: informationSchemaTable.tableName,
              columnName: row.column_name,
            }),
          };
        }
      );

      // update the information schema table
      await updateInformationSchemaTableById(
        organization,
        informationSchemaTableId,
        {
          columns,
          dateUpdated: new Date(),
        }
      );
    } catch (e) {
      logger.error(
        e,
        "Unable to refresh stale information schema table for: " +
          informationSchemaTableId +
          " Error: " +
          e.message
      );
    }
  }
);

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  agenda.define(
    UPDATE_STALE_INFORMATION_SCHEMA_TABLE_JOB_NAME,
    updateStaleInformationSchemaTable
  );
}

export async function queueUpdateStaleInformationSchemaTable(
  organization: string,
  informationSchemaTableId: string
) {
  if (!informationSchemaTableId || !organization) return;

  const job = agenda.create(UPDATE_STALE_INFORMATION_SCHEMA_TABLE_JOB_NAME, {
    organization,
    informationSchemaTableId,
  }) as UpdateStaleInformationSchemaTableJob;
  job.unique({ informationSchemaTableId, organization });
  job.schedule(new Date());
  await job.save();
}
