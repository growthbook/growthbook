import { ExperimentInterface } from "shared/types/experiment";
import {
  getExperimentsByIds,
  dangerousGetExperimentsForLifecycleReminders,
} from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import {
  notifyExperimentEndingSoon,
  notifyExperimentStale,
} from "back-end/src/services/experimentNotifications";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

// Candidates arrive sorted by organization, so one context and one lookup
// serve a whole batch.
const BATCH_SIZE = 100;

async function checkBatch(organization: string, ids: string[]): Promise<void> {
  let context: ReqContext;
  let experiments: ExperimentInterface[];
  try {
    context = await getContextForAgendaJobByOrgId(organization);
    experiments = await getExperimentsByIds(context, ids);
  } catch (error) {
    logger.error(
      { error, organization, experimentIds: ids },
      "Failed to load experiments for lifecycle reminders",
    );
    return;
  }
  for (const experiment of experiments) {
    // Re-check what the candidate scan filtered on; it can change in between.
    if (experiment.archived) continue;
    try {
      await notifyExperimentEndingSoon({ context, experiment });
      await notifyExperimentStale({ context, experiment });
    } catch (error) {
      logger.error(
        { error, experimentId: experiment.id, organization },
        "Failed to check experiment lifecycle reminders",
      );
    }
  }
}

export async function checkExperimentLifecycleReminders(
  renewLease: () => Promise<void>,
): Promise<void> {
  let processed = 0;
  let renewedAt = 0;
  let batchOrganization: string | null = null;
  let batch: string[] = [];
  for await (const candidate of dangerousGetExperimentsForLifecycleReminders()) {
    // Renew outside the per-experiment catch: losing the scheduler lease must
    // stop this worker, rather than let two workers dispatch the same reminders.
    if (processed++ % 100 === 0 || Date.now() - renewedAt >= 60000) {
      await renewLease();
      renewedAt = Date.now();
    }
    if (
      batchOrganization !== null &&
      (candidate.organization !== batchOrganization ||
        batch.length >= BATCH_SIZE)
    ) {
      await checkBatch(batchOrganization, batch);
      batch = [];
    }
    batchOrganization = candidate.organization;
    batch.push(candidate.id);
  }
  if (batchOrganization !== null && batch.length) {
    await checkBatch(batchOrganization, batch);
  }
}
