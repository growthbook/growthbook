import {
  AGREEMENT_TYPE_AI,
  HEALTH_SCORE_ALL_PROJECTS,
  ORG_DEFAULT_SCOPE,
} from "shared/validators";
import {
  GetQuality,
  combineProjectScores,
  computeHealthByProject,
  computeScopeHealth,
  getExperimentQualityScore,
  getHealthSettings,
  resolveExperimentQualitySettings,
  startOfUTCWeek,
} from "shared/enterprise";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import {
  getAISettingsForOrg,
  getContextForAgendaJobByOrgObject,
} from "back-end/src/services/organizations";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
import { IS_CLOUD } from "back-end/src/util/secrets";

const DAY_MS = 24 * 60 * 60 * 1000;
// The trend always scores the trailing 90 days, whatever range the page shows
const TREND_WINDOW_DAYS = 90;

async function getQualityScorer(
  context: ReqContext | ApiReqContext,
): Promise<GetQuality> {
  if (!context.hasPremiumFeature("experiment-quality-score")) return () => null;
  const [records, aiSettings, aiAgreement] = await Promise.all([
    context.models.experimentationHealthSettings.getAll(),
    getAISettingsForOrg(context),
    IS_CLOUD
      ? context.models.agreements.getAgreementForOrg(AGREEMENT_TYPE_AI)
      : null,
  ]);
  const byProject = new Map(records.map((r) => [r.project, r]));
  // Matches the page's useAISettings: Cloud also needs the AI agreement
  const aiEnabled = aiSettings.aiEnabled && (!IS_CLOUD || !!aiAgreement);
  return (experiment) => {
    const settings = resolveExperimentQualitySettings({
      orgRecord: byProject.get(ORG_DEFAULT_SCOPE),
      projectRecord: experiment.project
        ? byProject.get(experiment.project)
        : null,
      aiEnabled,
    });
    return settings
      ? getExperimentQualityScore({ experiment, settings })
      : null;
  };
}

// Stores this week's scores the first time anyone opens Health that week
export async function recordWeeklyHealthScores(
  context: ReqContext | ApiReqContext,
) {
  const weekStart = startOfUTCWeek(new Date());
  if (await context.models.insightsHealthScores.hasWeek(weekStart)) return;

  // Scores cover every experiment, not just the ones this user can read
  const system = getContextForAgendaJobByOrgObject(context.org);
  const experiments = await getAllExperiments(system, {
    includeArchived: true,
  });
  const now = new Date();
  const input = {
    experiments,
    window: {
      startDate: new Date(now.getTime() - TREND_WINDOW_DAYS * DAY_MS),
      endDate: now,
    },
    healthSettings: getHealthSettings(context.org.settings),
    getQuality: await getQualityScorer(system),
  };
  const projects = computeHealthByProject(input);
  const org = computeScopeHealth(input);
  const rows = [
    ...projects,
    // Written last, so a partial run is retried by the next visit
    {
      project: HEALTH_SCORE_ALL_PROJECTS,
      health: { ...org, score: combineProjectScores(projects) },
    },
  ];

  for (const { project, health } of rows) {
    try {
      await system.models.insightsHealthScores.record({
        scope: project,
        weekStart,
        score: health.score,
        quality: health.quality,
        healthyRate: health.healthyRate,
        completed: health.completed,
      });
    } catch (e) {
      // Another visit recorded this scope first
      if (!isDuplicateKeyError(e)) throw e;
    }
  }
}
