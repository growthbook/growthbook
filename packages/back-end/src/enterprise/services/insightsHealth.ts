import { ORG_DEFAULT_SCOPE } from "shared/validators";
import {
  GetQuality,
  combineProjectScores,
  computeHealthByProject,
  computeScopeHealth,
  getExperimentQualityScore,
  getHealthSettings,
  resolveExperimentQualitySettings,
} from "shared/enterprise";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import {
  getAISettingsForOrg,
  getContextForAgendaJobByOrgObject,
} from "back-end/src/services/organizations";
import { ReqContext } from "back-end/types/request";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";

const DAY_MS = 24 * 60 * 60 * 1000;
// The trend always scores the trailing 90 days, whatever range the page shows
const TREND_WINDOW_DAYS = 90;

export function startOfUTCWeek(date: Date): Date {
  const day = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day;
}

async function getQualityScorer(context: ReqContext): Promise<GetQuality> {
  if (!context.hasPremiumFeature("experiment-quality-score")) return () => null;
  const [records, aiSettings] = await Promise.all([
    context.models.experimentationHealthSettings.getAll(),
    getAISettingsForOrg(context),
  ]);
  const byProject = new Map(records.map((r) => [r.project, r]));
  const aiEnabled = !!context.org.settings?.aiEnabled && aiSettings.aiEnabled;
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
export async function recordWeeklyHealthScores(context: ReqContext) {
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
    { project: "", health: { ...org, score: combineProjectScores(projects) } },
  ];

  for (const { project, health } of rows) {
    try {
      await system.models.insightsHealthScores.record({
        project,
        weekStart,
        score: health.score,
        velocityScore: health.velocityScore,
        quality: health.quality,
        completed: health.completed,
      });
    } catch (e) {
      // Another visit recorded this scope first
      if (!isDuplicateKeyError(e)) throw e;
    }
  }
}
