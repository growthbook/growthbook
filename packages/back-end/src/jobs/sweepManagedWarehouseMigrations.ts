import Agenda from "agenda";
import { getCollection } from "back-end/src/util/mongo.util";
import { logger } from "back-end/src/util/logger";
import { getBackendFeatureValue } from "back-end/src/services/growthbook";
import { queueMigrateManagedWarehouse } from "back-end/src/jobs/migrateManagedWarehouse";

const JOB_NAME = "sweepManagedWarehouseMigrations";
const SWEEP_INTERVAL = "1 minute";
const BATCH_SIZE = 5;
const ENQUEUE_DELAY_MS = 1000;

type ManagedWarehouseDatasourceDoc = {
  organization: string;
  type: string;
  settings?: { useJsonColumns?: boolean };
};

// Managed warehouses that aren't fully migrated yet. Mirrors
// isManagedWarehouseAwaitingJsonMigration (useJsonColumns not set OR materializedColumns
// not yet cleared) plus a stuck-after-success `migrating: true`, so partially-migrated
// and stuck warehouses are still drained even if they're never queried. Never-provisioned
// legacy warehouses are included: they get a Mongo-only settings rewrite (no tables exist
// yet), so eventual provisioning creates JSON DDL directly. A fully migrated warehouse
// (useJsonColumns set, materializedColumns cleared, not migrating) drops out, so this set
// shrinks monotonically. countDocuments on this filter is also the cutover gate: once it
// holds at 0 there are no partial migrations left, so the legacy code paths can be
// removed.
const LEGACY_FILTER = {
  type: "growthbook_clickhouse",
  $or: [
    { "settings.useJsonColumns": { $ne: true } },
    { "settings.materializedColumns.0": { $exists: true } },
    { "settings.migrating": true },
  ],
} as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Proactively drains legacy warehouses by enqueuing the per-org migration job
// (deduped + idempotent) in small batches. Throughput is bounded by that job's
// concurrency cap, not this sweep, so a backlog of queued jobs is harmless.
const sweepManagedWarehouseMigrations = async () => {
  // Killswitch for the proactive background sweep. Default off (matches the old
  // env var); flip `managed-warehouse-migration-sweep` on in GrowthBook to drain
  // legacy warehouses. Evaluated per run so toggling takes effect without a redeploy.
  if (!getBackendFeatureValue("managed-warehouse-migration-sweep", false)) {
    return;
  }

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

  // Always schedule; the sweep body no-ops unless the feature flag is on, so the
  // flag can be toggled at runtime without restarting the app.
  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery(SWEEP_INTERVAL);
  await job.save();
}
