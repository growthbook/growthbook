import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { EXPERIMENT_REFRESH_FREQUENCY } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

// Time between experiment result updates (default 6 hours)
const UPDATE_EVERY = EXPERIMENT_REFRESH_FREQUENCY * 60 * 60 * 1000;

const QUEUE_SAFE_ROLLOUT_SNAPSHOT_UPDATES = "queueSafeRolloutSnapshotUpdates";
const QUEUE_SAFE_ROLLOUT_RULE_UPDATES = "queueSafeRolloutRuleUpdates";

import { createSafeRolloutSnapshot } from "back-end/src/services/safeRolloutSnapshots";
import { getFeature } from "back-end/src/models/FeatureModel";
const UPDATE_SINGLE_SAFE_ROLLOUT_RULE = "updateSingleSafeRolloutRule";
import {
  getAllRolloutsToBeUpdated,
  SafeRolloutAnalysisSettings,
  SafeRolloutAnalysisSettingsInterface,
} from "back-end/src/models/SafeRolloutAnalysisSettings";
import {
  FeatureInterface,
  SafeRolloutRule,
} from "back-end/src/validators/features";
type UpdateSingleSafeRolloutRuleJob = Job<{
  rule: SafeRolloutAnalysisSettingsInterface;
}>;

export default async function (agenda: Agenda) {
  agenda.define(QUEUE_SAFE_ROLLOUT_SNAPSHOT_UPDATES, async () => {
    const rules = await getAllRolloutsToBeUpdated();

    for await (const rule of rules) {
      await queueSafeRolloutSnapshotUpdate(rule);
    }
  });

  agenda.define(
    UPDATE_SINGLE_SAFE_ROLLOUT_RULE,
    // This job queries a datasource, which may be slow. Give it 30 minutes to complete.
    { lockLifetime: 30 * 60 * 1000 }, // 30 minutes
    updateSingleSafeRolloutRule
  );

  await startUpdateJob();

  async function startUpdateJob() {
    const updateResultsJob = agenda.create(QUEUE_SAFE_ROLLOUT_RULE_UPDATES, {});
    updateResultsJob.unique({});
    updateResultsJob.repeatEvery("10 minutes");
    await updateResultsJob.save();
  }

  async function queueSafeRolloutSnapshotUpdate(
    rule: SafeRolloutAnalysisSettingsInterface
  ) {
    const job = agenda.create(UPDATE_SINGLE_SAFE_ROLLOUT_RULE, {
      rule,
    }) as UpdateSingleSafeRolloutRuleJob;

    job.unique({
      rule,
    });
    job.schedule(new Date());
    await job.save();
  }
}

function getSafeRolloutRuleFromFeature(
  feature: FeatureInterface,
  ruleId: string
): SafeRolloutRule | null {
  Object.keys(feature.environmentSettings).forEach((env: any) =>
    env.rules.forEach((rule: any) => {
      if (rule.id === ruleId) {
        return rule;
      }
    })
  );
  return null;
}

async function updateSingleSafeRolloutRule(
  job: UpdateSingleSafeRolloutRuleJob
) {
  const rule = job.attrs.data?.rule;
  const { ruleId, organization, featureId } = rule;

  if (!ruleId || !organization || !featureId) return;
  const context = await getContextForAgendaJobByOrgId(organization);
  if (!featureId || !context) return;
  const feature = await getFeature(context, featureId);
  if (!feature) return;

  const safeRollout = getSafeRolloutRuleFromFeature(feature, ruleId);
  if (!safeRollout) return;

  try {
    logger.info("Start Refreshing Results for SafeRollout " + ruleId);
    await createSafeRolloutSnapshot({
      context,
      safeRollout,
      safeRolloutAnalysisSetting: rule,
      triggeredBy: "schedule",
    });
    // TODO: update the revision and the live version for the feature
    const safeRolloutAnalysisSettings = new SafeRolloutAnalysisSettings(
      context
    );
  } catch (e) {
    logger.error(e, "Failed to create SafeRollout Snapshot: " + ruleId);
  }
}
