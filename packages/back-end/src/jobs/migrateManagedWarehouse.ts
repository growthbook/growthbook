import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { migrateManagedWarehouseToJson } from "back-end/src/services/clickhouse";
import { getBackendFeatureValue } from "back-end/src/services/growthbook";
import { logger } from "back-end/src/util/logger";

const MIGRATE_MANAGED_WAREHOUSE = "migrateManagedWarehouse";
type MigrateManagedWarehouseJob = Job<{ organization: string }>;

// Cap concurrent migrations per instance. Each one triggers a license-server
// table recreate plus a burst of Mongo writes, so we keep the proactive sweep
// (and lazy on-read triggers) from running too many at once.
const MIGRATE_CONCURRENCY = 2;

let agenda: Agenda;

export default function (ag: Agenda) {
  agenda = ag;
  agenda.define(
    MIGRATE_MANAGED_WAREHOUSE,
    { concurrency: MIGRATE_CONCURRENCY, lockLimit: MIGRATE_CONCURRENCY },
    migrateManagedWarehouse,
  );
}

// Enqueue a one-time migration for an org's managed warehouse. Deduplicated per
// org so a burst of queries can't trigger concurrent recreates; the job itself
// is idempotent and no-ops if the warehouse is already migrated.
export async function queueMigrateManagedWarehouse(organization: string) {
  if (!agenda) return;
  const job = agenda.create(MIGRATE_MANAGED_WAREHOUSE, {
    organization,
  }) as MigrateManagedWarehouseJob;
  job.unique({ organization });
  job.schedule(new Date());
  await job.save();
}

const migrateManagedWarehouse = async (job: MigrateManagedWarehouseJob) => {
  const orgId = job.attrs.data?.organization;
  if (!orgId) return;

  if (
    !getBackendFeatureValue("managed-warehouse-json-migration", false, {
      organizationId: orgId,
    })
  ) {
    return;
  }

  const context = await getContextForAgendaJobByOrgId(orgId);
  try {
    await migrateManagedWarehouseToJson(context);
  } catch (e) {
    // Left in a re-runnable state; the next use of the warehouse re-enqueues this.
    logger.error(e, `Failed to migrate managed warehouse for org ${orgId}`);
  }
};
