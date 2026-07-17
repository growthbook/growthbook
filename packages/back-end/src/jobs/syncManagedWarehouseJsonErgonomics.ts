import Agenda, { Job } from "agenda";
import { MANAGED_WAREHOUSE_JSON_ERGONOMICS_VERSION } from "shared/util";
import { getCollection } from "back-end/src/util/mongo.util";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import {
  applyManagedWarehouseJsonErgonomics,
  syncManagedWarehouseIdentifiers,
} from "back-end/src/services/clickhouse";
import { dangerouslyGetGrowthbookDatasourceBypassPermission } from "back-end/src/models/DataSourceModel";
import { getBackendFeatureValue } from "back-end/src/services/growthbook";
import { logger } from "back-end/src/util/logger";

// One-time (per version) backfill of the JSON-ergonomics setup — per-org
// ClickHouse user settings + typed `attributes.<property>` ALIAS columns —
// across existing managed warehouses. Steady-state upkeep happens on attribute
// changes (syncManagedWarehouseIdentifiersOnAttributeChange) and at
// provision/recreate time on the license server; this sweep exists to bring
// already-provisioned warehouses up to the current version, then goes quiet.

const SYNC_JOB = "syncManagedWarehouseJsonErgonomics";
const SWEEP_JOB = "sweepManagedWarehouseJsonErgonomics";
const SWEEP_INTERVAL = "1 minute";
const BATCH_SIZE = 5;
const ENQUEUE_DELAY_MS = 1000;
// Each sync is a license-server round-trip holding the org's datasource lock;
// keep the proactive sweep from running too many at once.
const SYNC_CONCURRENCY = 2;

type SyncJob = Job<{ organization: string }>;

// Provisioned JSON-columns warehouses not yet on the current ergonomics
// version. Warehouses awaiting provisioning are excluded — they get the full
// setup during provisioning itself — and drop into this set if they provision
// while the sweep is live. Shrinks monotonically per version bump.
const PENDING_FILTER = {
  type: "growthbook_clickhouse",
  "settings.useJsonColumns": true,
  "settings.hasBeenProvisioned": { $ne: false },
  "settings.jsonErgonomicsVersion": {
    $ne: MANAGED_WAREHOUSE_JSON_ERGONOMICS_VERSION,
  },
} as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let agenda: Agenda;

const syncManagedWarehouseJsonErgonomics = async (job: SyncJob) => {
  const orgId = job.attrs.data?.organization;
  if (!orgId) return;

  const context = await getContextForAgendaJobByOrgId(orgId);
  try {
    const datasource =
      await dangerouslyGetGrowthbookDatasourceBypassPermission(context);
    if (!datasource || datasource.type !== "growthbook_clickhouse") return;

    // Persist the current typedAttributeColumns (and the rest of the
    // attribute-derived metadata) so the license server reads fresh state.
    await syncManagedWarehouseIdentifiers(context);

    // Apply the DDL. Returns false when there was nothing to alter yet
    // (unprovisioned/legacy/mid-recreate) — leave the version unset so the
    // sweep retries once the warehouse is ready.
    if (!(await applyManagedWarehouseJsonErgonomics(context))) return;

    // Record the applied version with a targeted $set: a full settings write
    // from a snapshot could revert a concurrent update (provisioning flipping
    // hasBeenProvisioned, an attribute sync writing typedAttributeColumns).
    await getCollection("datasources").updateOne(
      { organization: orgId, id: datasource.id },
      {
        $set: {
          "settings.jsonErgonomicsVersion":
            MANAGED_WAREHOUSE_JSON_ERGONOMICS_VERSION,
        },
      },
    );
  } catch (e) {
    // Version stays behind, so the next sweep pass retries this org.
    logger.error(
      e,
      `Failed to sync managed warehouse JSON ergonomics for org ${orgId}`,
    );
  }
};

// Proactively drains pending warehouses by enqueuing the per-org sync job
// (deduped + idempotent) in small batches. Throughput is bounded by that job's
// concurrency cap, not this sweep, so a backlog of queued jobs is harmless.
const sweepManagedWarehouseJsonErgonomics = async () => {
  // Killswitch for the proactive sweep; flip
  // `managed-warehouse-json-ergonomics-sweep` on in GrowthBook to run the
  // backfill. Evaluated per run so toggling takes effect without a redeploy.
  if (
    !getBackendFeatureValue("managed-warehouse-json-ergonomics-sweep", false)
  ) {
    return;
  }

  const datasources = getCollection("datasources");

  const remaining = await datasources.countDocuments(PENDING_FILTER);
  if (remaining === 0) return;

  const batch = await datasources
    .find(PENDING_FILTER, {
      projection: { organization: 1 },
      limit: BATCH_SIZE,
    })
    .toArray();

  for (const ds of batch) {
    const job = agenda.create(SYNC_JOB, {
      organization: ds.organization,
    }) as SyncJob;
    job.unique({ organization: ds.organization });
    job.schedule(new Date());
    await job.save();
    await sleep(ENQUEUE_DELAY_MS);
  }

  logger.info(
    `Managed warehouse JSON ergonomics sweep: enqueued ${batch.length}, ~${remaining} warehouses pending`,
  );
};

export default async function (ag: Agenda) {
  agenda = ag;
  agenda.define(
    SYNC_JOB,
    { concurrency: SYNC_CONCURRENCY, lockLimit: SYNC_CONCURRENCY },
    syncManagedWarehouseJsonErgonomics,
  );
  agenda.define(SWEEP_JOB, sweepManagedWarehouseJsonErgonomics);

  // Always schedule; the sweep body no-ops unless the feature flag is on, so
  // the flag can be toggled at runtime without restarting the app.
  const job = agenda.create(SWEEP_JOB, {});
  job.unique({});
  job.repeatEvery(SWEEP_INTERVAL);
  await job.save();
}
