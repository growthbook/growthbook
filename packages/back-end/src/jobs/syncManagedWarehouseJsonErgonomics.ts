import type { Agenda, Job } from "agenda";
import {
  isManagedWarehouseAwaitingProvisioning,
  MANAGED_WAREHOUSE_JSON_ERGONOMICS_VERSION,
} from "shared/util";
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
// ClickHouse user settings + typed `attributes.<property>` ALIAS columns +
// the persisted generated SQL — across existing managed warehouses. Steady-state
// upkeep happens on attribute changes (syncManagedWarehouseIdentifiersOnAttributeChange)
// and at provision/recreate time on the license server; this sweep exists to
// bring every warehouse up to the current version, then goes quiet.
//
// Unprovisioned warehouses are swept too, Mongo-side only: their persisted
// generated SQL dates from datasource creation and provisioning never refreshes
// it, so skipping them leaves stale SQL forever once the sweep drains. The
// physical DDL side is theirs at provision time, applied from the settings the
// sweep just refreshed.

const SYNC_JOB = "syncManagedWarehouseJsonErgonomics";
const SWEEP_JOB = "sweepManagedWarehouseJsonErgonomics";
const SWEEP_INTERVAL = "1 minute";
const BATCH_SIZE = 5;
const ENQUEUE_DELAY_MS = 1000;
// Each sync is a license-server round-trip holding the org's datasource lock;
// keep the proactive sweep from running too many at once.
const SYNC_CONCURRENCY = 2;

type SyncJob = Job<{ organization: string }>;

// JSON-columns warehouses (provisioned or not) not yet on the current
// ergonomics version. Shrinks monotonically per version bump.
const PENDING_FILTER = {
  type: "growthbook_clickhouse",
  "settings.useJsonColumns": true,
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

    // Apply the DDL — provisioned warehouses only. Unprovisioned ones have no
    // tables yet; the license server applies the full physical setup at
    // provision time from the settings persisted above, so skip the round trip
    // and fall through to record the version (leaving it unset would make
    // never-provisioning orgs hog the sweep batch forever). For provisioned
    // warehouses a false return (e.g. mid-recreate) leaves the version unset
    // so the sweep retries once the warehouse is ready.
    if (!isManagedWarehouseAwaitingProvisioning(datasource)) {
      if (!(await applyManagedWarehouseJsonErgonomics(context))) return;
    }

    // The sync above derives everything it persists (userIdTypes, typed
    // attribute columns, exposure queries, fact-table SQL) from the job-start
    // snapshots, so a concurrent attribute or datasource change could have been
    // overwritten with stale output. All of that state is a pure function of
    // three inputs, so only record the version while those inputs are unchanged
    // — comparing outputs instead would miss changes that alter identifier
    // behavior without touching the compared field (e.g. toggling hashAttribute
    // on an existing string attribute). On mismatch, leave the version unset so
    // the next sweep pass re-syncs from current state, healing the stale write.
    const freshContext = await getContextForAgendaJobByOrgId(orgId);
    const fresh =
      await dangerouslyGetGrowthbookDatasourceBypassPermission(freshContext);
    if (!fresh || fresh.type !== "growthbook_clickhouse") return;
    const derivationInputs = (org: typeof context.org, ds: typeof datasource) =>
      JSON.stringify([
        org.settings?.attributeSchema ?? [],
        ds.settings.migratedIdentifiers ?? [],
        ds.settings.migratedColumns ?? [],
        ds.settings.idAttributeIdentifier ?? "device_id",
      ]);
    if (
      derivationInputs(context.org, datasource) !==
      derivationInputs(freshContext.org, fresh)
    ) {
      logger.warn(
        `Managed warehouse JSON ergonomics sync raced a concurrent settings write for org ${orgId}; leaving version unset so the sweep retries`,
      );
      return;
    }

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
  agenda.define(SYNC_JOB, syncManagedWarehouseJsonErgonomics, {
    concurrency: SYNC_CONCURRENCY,
    lockLimit: SYNC_CONCURRENCY,
  });
  agenda.define(SWEEP_JOB, sweepManagedWarehouseJsonErgonomics);

  // Always schedule; the sweep body no-ops unless the feature flag is on, so
  // the flag can be toggled at runtime without restarting the app.
  const job = agenda.create(SWEEP_JOB, {});
  job.unique({});
  job.repeatEvery(SWEEP_INTERVAL);
  await job.save();
}
