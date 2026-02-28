import Agenda, { Job } from "agenda";
import { Column } from "shared/types/integrations";
import { fetchTableData } from "back-end/src/services/informationSchema";
import { logger } from "back-end/src/util/logger";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getInformationSchemaById } from "back-end/src/models/InformationSchemaModel";
import {
  getInformationSchemaTableById,
  updateInformationSchemaTableById,
} from "back-end/src/models/InformationSchemaTablesModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

const UPDATE_STALE_INFORMATION_SCHEMA_TABLE_JOB_NAME =
  "updateStaleInformationSchemaTable";
type UpdateStaleInformationSchemaTableJob = Job<{
  organizationId: string;
  informationSchemaTableId: string;
}>;

const updateStaleInformationSchemaTable = async (
  job: UpdateStaleInformationSchemaTableJob,
) => {
  const { organizationId, informationSchemaTableId } = job.attrs.data;

  if (!informationSchemaTableId || !organizationId) return;

  const informationSchemaTable = await getInformationSchemaTableById(
    organizationId,
    informationSchemaTableId,
  );

  if (!informationSchemaTable) {
    logger.error(
      "Unable to find information schema table in order to refresh stale data: " +
        informationSchemaTableId,
    );
    return;
  }

  const context = await getContextForAgendaJobByOrgId(organizationId);

  const datasource = await getDataSourceById(
    context,
    informationSchemaTable.datasourceId,
  );

  const informationSchema = await getInformationSchemaById(
    organizationId,
    informationSchemaTable.informationSchemaId,
  );

  if (!datasource || !informationSchema) {
    logger.error(
      "Unable to find datasource or information schema in order to refresh stale data: " +
        informationSchemaTableId,
    );
    return;
  }

  try {
    const { tableData } = await fetchTableData(
      context,
      datasource,
      informationSchema,
      informationSchemaTableId,
    );

    if (!tableData) {
      logger.error(
        "Unable to fetch table data in order to refresh stale data: " +
          informationSchemaTableId,
      );
      return;
    }

    const columns: Column[] = tableData.map(
      (row: { column_name: string; data_type: string }) => {
        return {
          columnName: row.column_name,
          dataType: row.data_type,
        };
      },
    );

    // update the information schema table
    await updateInformationSchemaTableById(
      organizationId,
      informationSchemaTableId,
      {
        columns,
        dateUpdated: new Date(),
      },
    );
  } catch (e) {
    logger.error(
      e,
      "Unable to refresh stale information schema table for: " +
        informationSchemaTableId,
    );
  }
};

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  agenda.define(
    UPDATE_STALE_INFORMATION_SCHEMA_TABLE_JOB_NAME,
    updateStaleInformationSchemaTable,
  );
}

export async function queueUpdateStaleInformationSchemaTable(
  organizationId: string,
  informationSchemaTableId: string,
) {
  if (!informationSchemaTableId || !organizationId) return;

  const job = agenda.create(UPDATE_STALE_INFORMATION_SCHEMA_TABLE_JOB_NAME, {
    organizationId,
    informationSchemaTableId,
  }) as UpdateStaleInformationSchemaTableJob;
  job.unique({ informationSchemaTableId, organization: organizationId });
  job.schedule(new Date());
  await job.save();
}
