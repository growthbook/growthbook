import Agenda, { Job } from "agenda";
import {
  advanceManagedWarehouseRecreate,
  countRunningManagedWarehouseRecreates,
  getOrganizationsWithRecreateStatus,
  MAX_CONCURRENT_RECREATES,
} from "back-end/src/services/managedWarehouseRecreate";
import { logger } from "back-end/src/util/logger";

// Works through super-admin recreate requests stored on Managed Warehouse
// datasources: starts pending ones while fewer than MAX_CONCURRENT_RECREATES
// are running, and records results for running ones.

const SWEEP_JOB = "sweepManagedWarehouseRecreates";
const RECREATE_JOB = "recreateManagedWarehouseTables";
const SWEEP_INTERVAL = "1 minute";
// Running recreates are only checked for a result, but cap how many are queued
// per sweep anyway.
const MAX_RUNNING_CHECKS = 20;

type RecreateJob = Job<{ organization: string }>;

let agenda: Agenda;

/** Queue the per-org job now instead of waiting for the next sweep. */
export async function queueManagedWarehouseRecreate(organization: string) {
  if (!agenda) return;
  const job = agenda.create(RECREATE_JOB, { organization }) as RecreateJob;
  job.unique({ organization });
  job.schedule(new Date());
  await job.save();
}

const recreateManagedWarehouseTables = async (job: RecreateJob) => {
  const organization = job.attrs.data?.organization;
  if (!organization) return;
  try {
    await advanceManagedWarehouseRecreate(organization);
  } catch (e) {
    // The request keeps its status, so the next sweep retries.
    logger.error(
      e,
      `Failed to advance Managed Warehouse recreate for ${organization}`,
    );
  }
};

const sweepManagedWarehouseRecreates = async () => {
  const running = await getOrganizationsWithRecreateStatus(
    "running",
    MAX_RUNNING_CHECKS,
  );
  const pending = await getOrganizationsWithRecreateStatus(
    "pending",
    MAX_CONCURRENT_RECREATES - (await countRunningManagedWarehouseRecreates()),
  );
  for (const organization of [...running, ...pending]) {
    await queueManagedWarehouseRecreate(organization);
  }
};

export default async function (ag: Agenda) {
  agenda = ag;
  // Each run is a few quick Mongo reads/writes and at most one license-server
  // call; one at a time keeps the running-count check race-free per instance.
  agenda.define(
    RECREATE_JOB,
    { concurrency: 1, lockLimit: 1 },
    recreateManagedWarehouseTables,
  );
  agenda.define(SWEEP_JOB, sweepManagedWarehouseRecreates);

  // Always scheduled; it does nothing when there are no requests.
  const job = agenda.create(SWEEP_JOB, {});
  job.unique({});
  job.repeatEvery(SWEEP_INTERVAL);
  await job.save();
}
