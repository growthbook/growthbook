import Agenda, { Job } from "agenda";
import { ReadAccessFilter } from "shared/permissions";
import { fetchTableData } from "../services/informationSchema";
import { logger } from "../util/logger";
import { getDataSourceById } from "../models/DataSourceModel";
import { getInformationSchemaById } from "../models/InformationSchemaModel";
import {
  getInformationSchemaTableById,
  updateInformationSchemaTableById,
} from "../models/InformationSchemaTablesModel";
import { Column } from "../types/Integration";
import { getPath } from "../util/informationSchemas";

const UPDATE_STALE_INFORMATION_SCHEMA_TABLE_JOB_NAME =
  "updateStaleInformationSchemaTable";
type UpdateStaleInformationSchemaTableJob = Job<{
  organization: string;
  informationSchemaTableId: string;
  readAccessFilter: ReadAccessFilter;
}>;

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  agenda.define(
    UPDATE_STALE_INFORMATION_SCHEMA_TABLE_JOB_NAME,
    async (job: UpdateStaleInformationSchemaTableJob) => {
      // console.log("starting the job!");
      const {
        organization,
        informationSchemaTableId,
        readAccessFilter,
      } = job.attrs.data;

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

      const datasource = await getDataSourceById(
        informationSchemaTable.datasourceId,
        organization,
        readAccessFilter
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
}

export async function queueUpdateStaleInformationSchemaTable(
  organization: string,
  informationSchemaTableId: string,
  readAccessFilter: ReadAccessFilter
) {
  if (!informationSchemaTableId || !organization) return;

  const job = agenda.create(UPDATE_STALE_INFORMATION_SCHEMA_TABLE_JOB_NAME, {
    organization,
    informationSchemaTableId,
    readAccessFilter,
  }) as UpdateStaleInformationSchemaTableJob;
  job.unique({ informationSchemaTableId, organization });
  job.schedule(new Date());
  await job.save();
}
