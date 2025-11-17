import Agenda, { Job } from "agenda";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { createExperimentSnapshot } from "back-end/src/controllers/experiments";

const CREATE_MANUAL_SNAPSHOT = "createManualSnapshot";

type CreateManualSnapshotJob = Job<{
  organization: string;
  experimentId: string;
  phase: number;
  dimension?: string;
  useCache?: boolean;
  type?: "standard" | "exploratory";
}>;

export default async function (agenda: Agenda) {
  agenda.define(CREATE_MANUAL_SNAPSHOT, createManualSnapshot);
}

const createManualSnapshot = async (job: CreateManualSnapshotJob) => {
  const experimentId = job.attrs.data?.experimentId;
  const orgId = job.attrs.data?.organization;
  const phase = job.attrs.data?.phase;
  const dimension = job.attrs.data?.dimension;
  const useCache = job.attrs.data?.useCache ?? true;
  const type = job.attrs.data?.type;

  if (!experimentId || !orgId || phase === undefined) {
    throw new Error("Missing required job parameters");
  }

  const context = await getContextForAgendaJobByOrgId(orgId);

  const experiment = await getExperimentById(context, experimentId);
  if (!experiment) {
    throw new Error(`Experiment ${experimentId} not found`);
  }

  if (!experiment.datasource) {
    throw new Error("Experiment does not have a datasource");
  }

  const datasource = await getDataSourceById(context, experiment.datasource);
  if (!datasource) {
    throw new Error(`Datasource ${experiment.datasource} not found`);
  }

  logger.info(`Creating manual snapshot for experiment ${experimentId}`);

  await createExperimentSnapshot({
    context,
    experiment,
    datasource,
    dimension,
    phase,
    useCache,
    triggeredBy: "manual",
    type,
  });

  logger.info(`Manual snapshot created for experiment ${experimentId}`);
};

export async function queueManualSnapshotJob(
  agenda: Agenda,
  organization: string,
  experimentId: string,
  phase: number,
  dimension?: string,
  useCache = true,
  type?: "standard" | "exploratory",
): Promise<string> {
  const job = agenda.create(CREATE_MANUAL_SNAPSHOT, {
    organization,
    experimentId,
    phase,
    dimension,
    useCache,
    type,
  }) as CreateManualSnapshotJob;

  job.schedule(new Date());
  await job.save();

  return job.attrs._id?.toString() || "";
}
