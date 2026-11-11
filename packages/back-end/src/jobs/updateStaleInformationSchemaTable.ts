import Agenda, { Job } from "agenda";
import { refreshInformationSchemaTable } from "back-end/src/services/informationSchema";
import { logger } from "back-end/src/util/logger";
import { getInformationSchemaTableById } from "back-end/src/models/InformationSchemaTablesModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

const UPDATE_STALE_INFORMATION_SCHEMA_TABLE_JOB_NAME =
  "updateStaleInformationSchemaTable";
type UpdateStaleInformationSchemaTableJob = Job<{
  organization: string;
  informationSchemaTableId: string;
}>;

const updateStaleInformationSchemaTable = async (
  job: UpdateStaleInformationSchemaTableJob,
) => {
  // console.log("starting the job!");
  const { organization, informationSchemaTableId } = job.attrs.data;

  if (!informationSchemaTableId || !organization) return;

  const informationSchemaTable = await getInformationSchemaTableById(
    organization,
    informationSchemaTableId,
  );

  if (!informationSchemaTable) {
    logger.error(
      "Unable to find information schema table in order to refresh stale data: " +
        informationSchemaTableId,
    );
    return;
  }

  const context = await getContextForAgendaJobByOrgId(organization);

  try {
    await refreshInformationSchemaTable(context, informationSchemaTable);
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
  organization: string,
  informationSchemaTableId: string,
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
