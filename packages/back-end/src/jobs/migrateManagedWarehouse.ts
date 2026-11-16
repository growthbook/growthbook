import Agenda, { Job } from "agenda";
import { getManagedWarehouseUnmappedBuiltinIdentifiers } from "shared/util";
import { GrowthbookClickhouseDataSource } from "shared/types/datasource";
import { getCollection } from "back-end/src/util/mongo.util";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { syncManagedWarehouseIdentifiers } from "back-end/src/services/clickhouse";
import { dangerouslyGetGrowthbookDatasourceBypassPermission } from "back-end/src/models/DataSourceModel";
import { logger } from "back-end/src/util/logger";

// Versioned, one-way migrations of existing managed warehouses. Each warehouse
// records the last one applied in `settings.appliedMigrationVersion` and is
// moved up to `settings.desiredMigrationVersion`, which super admins set per
// org or in bulk. A migration can therefore ship dark, be tried on a few orgs,
// then rolled out to the rest. Lowering the desired version stops further
// migrations but does not undo applied ones. New warehouses start on the latest.

const MIGRATE_JOB = "migrateManagedWarehouse";
const SWEEP_JOB = "sweepManagedWarehouseMigrations";
const SWEEP_INTERVAL = "1 minute";
const BATCH_SIZE = 20;
const MIGRATE_CONCURRENCY = 2;

type MigrateJob = Job<{ organization: string }>;
type JobContext = Awaited<ReturnType<typeof getContextForAgendaJobByOrgId>>;

// Returns false to leave the version unchanged so the next sweep pass retries.
// On success, returns the settings the migration wrote: the version is only
// recorded while they still hold, because a concurrent full-settings write (an
// attribute sync working from an older snapshot) can revert them.
type Migration = (
  context: JobContext,
  datasource: GrowthbookClickhouseDataSource,
) => Promise<false | Record<string, unknown>>;

async function getWarehouse(orgId: string) {
  const context = await getContextForAgendaJobByOrgId(orgId);
  const datasource =
    await dangerouslyGetGrowthbookDatasourceBypassPermission(context);
  if (
    !datasource ||
    datasource.type !== "growthbook_clickhouse" ||
    !datasource.settings.useJsonColumns
  ) {
    return null;
  }
  return { context, datasource };
}

// v1: identifiers follow the attribute schema. Built-ins no hash attribute maps
// to are kept as legacy identifiers so nothing that references them breaks.
const useSchemaDerivedIdentifiers: Migration = async (context, datasource) => {
  const orgId = context.org.id;
  await getCollection("datasources").updateOne(
    { organization: orgId, id: datasource.id },
    {
      $set: { "settings.identifiersFromAttributes": true },
      $addToSet: {
        "settings.migratedIdentifiers": {
          $each: getManagedWarehouseUnmappedBuiltinIdentifiers(
            datasource.settings,
            context.org.settings?.attributeSchema,
          ),
        },
      },
    },
  );

  const migrated = await getWarehouse(orgId);
  if (!migrated?.datasource.settings.identifiersFromAttributes) return false;
  await syncManagedWarehouseIdentifiers(migrated.context);

  // The sync persists output derived from the snapshot above, so a concurrent
  // attribute or datasource change may have been overwritten. Retry if so.
  const fresh = await getWarehouse(orgId);
  const inputs = (w: typeof migrated) =>
    JSON.stringify([
      w.context.org.settings?.attributeSchema ?? [],
      w.datasource.settings.migratedIdentifiers ?? [],
      w.datasource.settings.migratedColumns ?? [],
    ]);
  if (!fresh || inputs(migrated) !== inputs(fresh)) return false;
  return { "settings.identifiersFromAttributes": true };
};

// Index + 1 is the version a migration brings a warehouse to. Append only.
const MIGRATIONS: Migration[] = [useSchemaDerivedIdentifiers];

export const MANAGED_WAREHOUSE_MIGRATION_VERSION = MIGRATIONS.length;

const JSON_WAREHOUSES = {
  type: "growthbook_clickhouse",
  "settings.useJsonColumns": true,
} as const;

// Behind their desired version, capped at what this build can run.
const PENDING_FILTER = {
  ...JSON_WAREHOUSES,
  $expr: {
    $lt: [
      { $ifNull: ["$settings.appliedMigrationVersion", 0] },
      {
        $min: [
          { $ifNull: ["$settings.desiredMigrationVersion", 0] },
          MIGRATIONS.length,
        ],
      },
    ],
  },
};

export async function setManagedWarehouseDesiredMigrationVersion(
  organizations: string[] | "all",
  version: number,
): Promise<number> {
  const res = await getCollection("datasources").updateMany(
    {
      ...JSON_WAREHOUSES,
      ...(organizations === "all"
        ? {}
        : { organization: { $in: organizations } }),
    },
    { $set: { "settings.desiredMigrationVersion": version } },
  );
  return res.matchedCount;
}

// Warehouse counts by applied version, plus how many are waiting to migrate.
export async function getManagedWarehouseMigrationSummary() {
  const datasources = getCollection("datasources");
  const [applied, pending] = await Promise.all([
    datasources
      .aggregate<{ _id: number; count: number }>([
        { $match: JSON_WAREHOUSES },
        {
          $group: {
            _id: { $ifNull: ["$settings.appliedMigrationVersion", 0] },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    datasources.countDocuments(PENDING_FILTER),
  ]);
  return {
    latestVersion: MANAGED_WAREHOUSE_MIGRATION_VERSION,
    applied: applied.map((a) => ({ version: a._id, count: a.count })),
    pending,
  };
}

let agenda: Agenda;

const migrateManagedWarehouse = async (job: MigrateJob) => {
  const orgId = job.attrs.data?.organization;
  if (!orgId) return;

  try {
    for (;;) {
      const warehouse = await getWarehouse(orgId);
      if (!warehouse) return;
      const { context, datasource } = warehouse;
      const version = datasource.settings.appliedMigrationVersion ?? 0;
      const desired = datasource.settings.desiredMigrationVersion ?? 0;
      if (version >= Math.min(desired, MIGRATIONS.length)) return;

      const result = await MIGRATIONS[version](context, datasource);
      const recorded =
        result &&
        (
          await getCollection("datasources").updateOne(
            { organization: orgId, id: datasource.id, ...result },
            { $set: { "settings.appliedMigrationVersion": version + 1 } },
          )
        ).matchedCount > 0;
      if (!recorded) {
        logger.warn(
          `Managed warehouse migration v${version + 1} did not complete for org ${orgId}; the sweep will retry`,
        );
        return;
      }
      logger.info(
        `Managed warehouse migrated to v${version + 1} for org ${orgId}`,
      );
    }
  } catch (e) {
    // Version stays behind, so the next sweep pass retries this org.
    logger.error(e, `Failed to migrate managed warehouse for org ${orgId}`);
  }
};

const sweepManagedWarehouseMigrations = async () => {
  // Random batch, so a warehouse that keeps failing can't starve the rest
  const due = await getCollection("datasources")
    .aggregate<{ organization: string }>([
      { $match: PENDING_FILTER },
      { $sample: { size: BATCH_SIZE } },
      { $project: { organization: 1 } },
    ])
    .toArray();
  if (!due.length) return;

  for (const ds of due) {
    const job = agenda.create(MIGRATE_JOB, {
      organization: ds.organization,
    }) as MigrateJob;
    job.unique({ organization: ds.organization });
    job.schedule(new Date());
    await job.save();
  }

  logger.info(`Managed warehouse migration sweep: enqueued ${due.length}`);
};

export default async function (ag: Agenda) {
  agenda = ag;
  agenda.define(
    MIGRATE_JOB,
    { concurrency: MIGRATE_CONCURRENCY, lockLimit: MIGRATE_CONCURRENCY },
    migrateManagedWarehouse,
  );
  agenda.define(SWEEP_JOB, sweepManagedWarehouseMigrations);

  const job = agenda.create(SWEEP_JOB, {});
  job.unique({});
  job.repeatEvery(SWEEP_INTERVAL);
  await job.save();
}
