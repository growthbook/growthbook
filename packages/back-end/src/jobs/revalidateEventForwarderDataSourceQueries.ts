import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { revalidateManagedEventForwarderDataSourceQueries } from "back-end/src/services/eventForwarder/warehouseSync";
import { logger } from "back-end/src/util/logger";

const JOB_NAME = "revalidateEventForwarderDataSourceQueries";

type RevalidateEventForwarderDataSourceQueriesJob = Job<{
  organization: string;
  datasourceId: string;
}>;

const revalidateEventForwarderDataSourceQueries = async (
  job: RevalidateEventForwarderDataSourceQueriesJob,
) => {
  const { organization, datasourceId } = job.attrs.data;

  if (!organization || !datasourceId) {
    return;
  }

  try {
    const context = await getContextForAgendaJobByOrgId(organization);
    await revalidateManagedEventForwarderDataSourceQueries(
      context,
      datasourceId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      {
        organization,
        datasourceId,
        error: message,
      },
      "Failed to revalidate event forwarder datasource queries",
    );
  }
};

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;
  agenda.define(JOB_NAME, revalidateEventForwarderDataSourceQueries);
}

export async function queueRevalidateEventForwarderDataSourceQueriesAt(
  organization: string,
  datasourceId: string,
  runAt: Date,
): Promise<void> {
  const job = agenda.create(JOB_NAME, {
    organization,
    datasourceId,
  }) as RevalidateEventForwarderDataSourceQueriesJob;
  job.unique({
    organization,
    datasourceId,
  });
  job.schedule(runAt);
  await job.save();
}
