import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { EXPERIMENT_REFRESH_FREQUENCY } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

// Time between experiment result updates (default 6 hours)
const UPDATE_EVERY = EXPERIMENT_REFRESH_FREQUENCY * 60 * 60 * 1000;

const QUEUE_SAFE_ROLLOUT_SNAPSHOT_UPDATES = "queueSafeRolloutSnapshotUpdates";
const QUEUE_SAFE_ROLLOUT_RULE_UPDATES = "queueSafeRolloutRuleUpdates";

import {
  getSafeRolloutRuleById,
  getSafeRolloutRulesToUpdate,
  updateSafeRolloutRule,
} from "back-end/src/models/FeatureRevisionModel";
import { createSafeRolloutSnapshot } from "back-end/src/services/safeRolloutSnapshots";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
const UPDATE_SINGLE_SAFE_ROLLOUT_RULE = "updateSingleSafeRolloutRule";
type UpdateSingleSafeRolloutRuleJob = Job<{
  organization: string;
  ruleId: string;
}>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_SAFE_ROLLOUT_SNAPSHOT_UPDATES, async () => {
    const rules = await getSafeRolloutRulesToUpdate();

    for (const rule of rules) {
      await queueExperimentUpdate(rule.organization, rule.id);
    }
  });

  agenda.define(
    UPDATE_SINGLE_SAFE_ROLLOUT_RULE,
    // This job queries a datasource, which may be slow. Give it 30 minutes to complete.
    { lockLifetime: 30 * 60 * 1000 },
    updateSingleSafeRolloutRule
  );

  // Update experiment results
  await startUpdateJob();

  async function startUpdateJob() {
    const updateResultsJob = agenda.create(QUEUE_SAFE_ROLLOUT_RULE_UPDATES, {});
    updateResultsJob.unique({});
    updateResultsJob.repeatEvery("10 minutes");
    await updateResultsJob.save();
  }

  async function queueExperimentUpdate(organization: string, ruleId: string) {
    const job = agenda.create(UPDATE_SINGLE_SAFE_ROLLOUT_RULE, {
      organization,
      ruleId,
    }) as UpdateSingleSafeRolloutRuleJob;

    job.unique({
      ruleId,
      organization,
    });
    job.schedule(new Date());
    await job.save();
  }
}

async function updateSingleSafeRolloutRule(
  job: UpdateSingleSafeRolloutRuleJob
) {
  const ruleId = job.attrs.data?.ruleId;
  const orgId = job.attrs.data?.organization;

  if (!ruleId || !orgId) return;

  const context = await getContextForAgendaJobByOrgId(orgId);
  const safeRollout = await getSafeRolloutRuleById(context, ruleId);
  if (!safeRollout) return;
  const datasourceId = safeRollout.datasource;
  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) return;
  try {
    logger.info("Start Refreshing Results for SafeRollout " + ruleId);
    await createSafeRolloutSnapshot({
      context,
      safeRollout,
      datasource,
    });
    await updateSafeRolloutRule(context, {
      ...safeRollout,
      nextSnapshotAttempt: new Date(Date.now() + UPDATE_EVERY),
      lastSnapshotAttempt: new Date(),
    });
  } catch (e) {
    logger.error(e, "Failed to create SafeRollout Snapshot: " + ruleId);
  }
}
