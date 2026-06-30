import Agenda from "agenda";
import { getCollection } from "back-end/src/util/mongo.util";
import { logger } from "back-end/src/util/logger";
import { MANAGED_WAREHOUSE_MIGRATION_SWEEP_ENABLED } from "back-end/src/util/secrets";
import { queueMigrateManagedWarehouse } from "back-end/src/jobs/migrateManagedWarehouse";

const JOB_NAME = "sweepManagedWarehouseMigrations";
const SWEEP_INTERVAL = "1 minute";
const BATCH_SIZE = 5;
const ENQUEUE_DELAY_MS = 1000;

type ManagedWarehouseDatasourceDoc = {
  organization: string;
  type: string;
  settings?: { useJsonColumns?: boolean; hasBeenProvisioned?: boolean };
};

// Provisioned managed warehouses still on the legacy materialized-column model.
// A migrated warehouse sets useJsonColumns=true and drops out, so this set
// shrinks monotonically until the drain is complete. countDocuments on this
// filter is also the cutover gate: once it holds at 0, the legacy code paths
// can be removed.
const LEGACY_FILTER = {
  type: "growthbook_clickhouse",
  "settings.useJsonColumns": { $ne: true },
  "settings.hasBeenProvisioned": { $ne: false },
} as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Proactively drains legacy warehouses by enqueuing the per-org migration job
// (deduped + idempotent) in small batches. Throughput is bounded by that job's
// concurrency cap, not this sweep, so a backlog of queued jobs is harmless.
const sweepManagedWarehouseMigrations = async () => {
  const datasources =
    getCollection<ManagedWarehouseDatasourceDoc>("datasources");

  const remaining = await datasources.countDocuments(LEGACY_FILTER);
  if (remaining === 0) return;

  const batch = await datasources
    .find(LEGACY_FILTER, { projection: { organization: 1 }, limit: BATCH_SIZE })
    .toArray();

  for (const ds of batch) {
    await queueMigrateManagedWarehouse(ds.organization);
    await sleep(ENQUEUE_DELAY_MS);
  }

  logger.info(
    `Managed warehouse migration sweep: enqueued ${batch.length}, ~${remaining} legacy warehouses remaining`,
  );
};

export default async function (agenda: Agenda) {
  agenda.define(JOB_NAME, sweepManagedWarehouseMigrations);

  if (!MANAGED_WAREHOUSE_MIGRATION_SWEEP_ENABLED) return;

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery(SWEEP_INTERVAL);
  await job.save();
}
