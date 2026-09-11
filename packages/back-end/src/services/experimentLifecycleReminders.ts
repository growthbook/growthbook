import {
  getExperimentById,
  getExperimentsForLifecycleReminders,
} from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import {
  notifyExperimentEndingSoon,
  notifyExperimentStale,
} from "back-end/src/services/experimentNotifications";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

export async function checkExperimentLifecycleReminders(
  renewLease: () => Promise<void>,
): Promise<void> {
  let context: ReqContext | null = null;
  let processed = 0;
  let renewedAt = 0;
  for await (const candidate of getExperimentsForLifecycleReminders()) {
    // Renew outside the per-experiment catch: losing the scheduler lease must
    // stop this worker, rather than let two workers dispatch the same reminders.
    if (processed++ % 100 === 0 || Date.now() - renewedAt >= 60000) {
      await renewLease();
      renewedAt = Date.now();
    }
    try {
      if (context?.org.id !== candidate.organization) {
        context = await getContextForAgendaJobByOrgId(candidate.organization);
      }
      const experiment = await getExperimentById(context, candidate.id);
      if (!experiment || experiment.archived) continue;
      await notifyExperimentEndingSoon({ context, experiment });
      await notifyExperimentStale({ context, experiment });
    } catch (error) {
      logger.error(
        {
          error,
          experimentId: candidate.id,
          organization: candidate.organization,
        },
        "Failed to check experiment lifecycle reminders",
      );
    }
  }
}
