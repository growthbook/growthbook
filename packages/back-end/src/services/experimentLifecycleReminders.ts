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

const BATCH_SIZE = 100;

export async function checkExperimentLifecycleReminders(
  renewLease: () => Promise<void>,
): Promise<void> {
  let processed = 0;
  let renewedAt = 0;
  // Called between steps, never inside a per-experiment catch: losing the
  // scheduler lease must stop this worker rather than let two workers dispatch
  // the same reminders.
  const renewIfDue = async () => {
    if (processed++ % 100 === 0 || Date.now() - renewedAt >= 60000) {
      await renewLease();
      renewedAt = Date.now();
    }
  };

  // The scan is unordered and tiny per row; grouping here saves a database sort.
  const byOrganization = new Map<string, string[]>();
  for await (const candidate of dangerousGetExperimentsForLifecycleReminders()) {
    await renewIfDue();
    const ids = byOrganization.get(candidate.organization) ?? [];
    ids.push(candidate.id);
    byOrganization.set(candidate.organization, ids);
  }

  for (const [organization, ids] of byOrganization) {
    let context;
    try {
      context = await getContextForAgendaJobByOrgId(organization);
    } catch (error) {
      logger.error(
        { error, organization },
        "Failed to load organization for lifecycle reminders",
      );
      continue;
    }
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      let experiments;
      try {
        experiments = await getExperimentsByIds(context, batch);
      } catch (error) {
        logger.error(
          { error, organization, experimentIds: batch },
          "Failed to load experiments for lifecycle reminders",
        );
        continue;
      }
      for (const experiment of experiments) {
        await renewIfDue();
        // Re-check what the scan filtered on; it can change in between.
        if (experiment.archived || experiment.status !== "running") continue;
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
  }
}
