import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { migrateManagedWarehouseToJson } from "back-end/src/services/clickhouse";
import { logger } from "back-end/src/util/logger";

const MIGRATE_MANAGED_WAREHOUSE = "migrateManagedWarehouse";
type MigrateManagedWarehouseJob = Job<{ organization: string }>;

let agenda: Agenda;

export default function (ag: Agenda) {
  agenda = ag;
  agenda.define(MIGRATE_MANAGED_WAREHOUSE, migrateManagedWarehouse);
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

  const context = await getContextForAgendaJobByOrgId(orgId);
  try {
    await migrateManagedWarehouseToJson(context);
  } catch (e) {
    // Left in a re-runnable state; the next use of the warehouse re-enqueues this.
    logger.error(e, `Failed to migrate managed warehouse for org ${orgId}`);
  }
};
