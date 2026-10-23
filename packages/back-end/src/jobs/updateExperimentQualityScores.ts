import Agenda from "agenda";
import {
  EXPERIMENT_PROCESS_RULES_VERSION,
  EXPERIMENT_QUALITY_PROMPT_VERSION,
} from "shared/enterprise";
import {
  getAISettingsForOrg,
  getContextForAgendaJobByOrgId,
} from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import {
  getExperimentById,
  getExperimentIdsNeedingProcessResults,
  getExperimentIdsPage,
  getExperimentsByIds,
} from "back-end/src/models/ExperimentModel";
import { queueExperimentProcessScoreBackfill } from "back-end/src/jobs/updateExperimentProcessScores";
import {
  AIQualityOutcome,
  computeAndStoreAIQualityChecks,
  getQualityScopeFilter,
  loadAIQualityInputs,
} from "back-end/src/enterprise/services/experimentQualityScore";
import { EXPERIMENTATION_HEALTH_SETTINGS_COLLECTION } from "back-end/src/enterprise/models/ExperimentationHealthSettingsModel";
import {
  RECHECK_EXPERIMENT_QUALITY,
  RecheckExperimentQualityJob,
  UPDATE_SINGLE_EXPERIMENT_QUALITY,
  UpdateSingleExperimentQualityJob,
  queueExperimentQualityRecheck,
  queueExperimentQualityScoreUpdate,
} from "back-end/src/jobs/experimentQualityScoreQueue";
import { getCollection } from "back-end/src/util/mongo.util";

// Edits, settings saves and turning AI on queue their own updates; this
// daily pass only catches what those can't: results from an older release
// of the checks, and stopped experiments without process results.
const DAILY_QUALITY_CHECK = "dailyExperimentQualityCheck";

const PAGE_SIZE = 25;
// Waits before retrying a failed AI call
const RETRY_DELAYS_MS = [5, 30, 120].map((minutes) => minutes * 60 * 1000);

export default async function (agenda: Agenda) {
  agenda.define(DAILY_QUALITY_CHECK, async () => {
    // Cross-org, so it reads the collection directly
    const orgIds: string[] = await getCollection(
      EXPERIMENTATION_HEALTH_SETTINGS_COLLECTION,
    ).distinct("organization", { "quality.enabled": true });
    for (const organization of orgIds) {
      await queueExperimentQualityRecheck({ organization, outdatedOnly: true });
    }
  });
  agenda.define(RECHECK_EXPERIMENT_QUALITY, recheckExperimentQuality);
  agenda.define(
    UPDATE_SINGLE_EXPERIMENT_QUALITY,
    updateSingleExperimentQuality,
  );

  const job = agenda.create(DAILY_QUALITY_CHECK, {});
  job.unique({});
  job.repeatEvery("1 day");
  await job.save();
}

// Retries a failed AI call, then leaves the error on the experiment
async function retryFailedAICall(
  organization: string,
  experimentId: string,
  attempt = 0,
) {
  if (attempt >= RETRY_DELAYS_MS.length) return;
  await queueExperimentQualityScoreUpdate({
    experimentId,
    organization,
    force: true,
    attempt: attempt + 1,
    delayMs: RETRY_DELAYS_MS[attempt],
  });
}

const recheckExperimentQuality = async (job: RecheckExperimentQualityJob) => {
  const data = job.attrs.data;
  if (!data?.organization) return;
  const { organization, force, project, outdatedOnly, after = "" } = data;

  const context = await getContextForAgendaJobByOrgId(organization);
  if (!context.hasPremiumFeature("experiment-quality-score")) return;
  const scope = getQualityScopeFilter(
    await context.models.experimentationHealthSettings.getAll(),
  );
  if (!scope) return;

  // Once per pass: process results for experiments stopped before scoring
  // was turned on, or before a release changed the rules
  if (!after) {
    const processIds = await getExperimentIdsNeedingProcessResults(
      organization,
      EXPERIMENT_PROCESS_RULES_VERSION,
    );
    if (processIds.length) {
      await queueExperimentProcessScoreBackfill(organization, processIds);
    }
  }

  if (
    !context.org.settings?.aiEnabled ||
    !(await getAISettingsForOrg(context)).aiEnabled
  ) {
    return;
  }

  const ids = await getExperimentIdsPage(organization, {
    after,
    limit: PAGE_SIZE,
    filter: {
      $and: [
        scope,
        project ? { project } : {},
        outdatedOnly
          ? {
              hypothesis: { $nin: ["", null] },
              "aiQualityResults.version": {
                $ne: EXPERIMENT_QUALITY_PROMPT_VERSION,
              },
            }
          : {},
      ],
    },
  });
  // In id order, so a rate-limited page can resume where it stopped
  const experiments = (await getExperimentsByIds(context, ids)).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const inputs = await loadAIQualityInputs(
    context,
    experiments.flatMap((e) => e.goalMetrics),
  );

  for (const experiment of experiments) {
    let outcome: AIQualityOutcome;
    try {
      outcome = await computeAndStoreAIQualityChecks({
        context,
        experiment,
        force,
        inputs,
      });
    } catch (e) {
      logger.error(e, `AI quality recheck failed for ${experiment.id}`);
      continue;
    }
    if (outcome.status === "rate-limited") {
      // Resume from this experiment once the limit resets
      const index = experiments.indexOf(experiment);
      await queueExperimentQualityRecheck(
        { ...data, after: index ? experiments[index - 1].id : after },
        { delayMs: outcome.retryInSeconds * 1000, dedupe: false },
      );
      return;
    }
    if (outcome.status === "failed") {
      await retryFailedAICall(organization, experiment.id);
    }
  }

  if (ids.length === PAGE_SIZE) {
    await queueExperimentQualityRecheck({
      ...data,
      after: ids[ids.length - 1],
    });
  }
};

const updateSingleExperimentQuality = async (
  job: UpdateSingleExperimentQualityJob,
) => {
  const { experimentId, organization, force, attempt } = job.attrs.data ?? {};
  if (!experimentId || !organization) return;

  const context = await getContextForAgendaJobByOrgId(organization);
  const experiment = await getExperimentById(context, experimentId);
  if (!experiment || experiment.archived) return;

  const outcome = await computeAndStoreAIQualityChecks({
    context,
    experiment,
    force,
  });
  if (outcome.status === "rate-limited") {
    await queueExperimentQualityScoreUpdate({
      experimentId,
      organization,
      force,
      attempt: (attempt ?? 0) + 1,
      delayMs: outcome.retryInSeconds * 1000,
    });
  } else if (outcome.status === "failed") {
    await retryFailedAICall(organization, experimentId, attempt);
  }
};
