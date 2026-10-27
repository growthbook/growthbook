import type { Response } from "express";
import {
  CustomQualityCheck,
  ExperimentationHealthQualitySettings,
  ORG_DEFAULT_SCOPE,
} from "shared/validators";
import { countHealthOverrides } from "shared/enterprise";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ReqContext } from "back-end/types/request";
import { queueExperimentQualityRecheck } from "back-end/src/jobs/experimentQualityScoreQueue";
import { logger } from "back-end/src/util/logger";
import { classifyCustomCheckJudge } from "back-end/src/enterprise/services/decisionModel";

function requireQualityScoreFeature(context: ReqContext) {
  if (!context.hasPremiumFeature("experiment-quality-score")) {
    context.throwPlanDoesNotAllowError(
      "Your organization does not have access to experiment quality scores",
    );
  }
}

// Saved settings change what's checked, so the scope's scores are rechecked
function recheckScope(context: ReqContext, project: string) {
  queueExperimentQualityRecheck({
    organization: context.org.id,
    project: project || undefined,
  }).catch((e) => logger.error(e, "Failed to queue a quality recheck"));
}

// Picks a judge for each custom rule that's new or changed, unless an admin
// chose one; unchanged rules keep the judge they were saved with
async function classifyCustomChecks(
  checks: CustomQualityCheck[],
  saved: CustomQualityCheck[],
): Promise<CustomQualityCheck[]> {
  return Promise.all(
    checks.map(async (check) => {
      if (check.judgeChosenBy === "admin" && check.judge) return check;
      const before = saved.find((c) => c.id === check.id);
      const judge =
        before?.judgeChosenBy !== "admin" &&
        before?.rule === check.rule &&
        before.judge
          ? before.judge
          : await classifyCustomCheckJudge(check.rule);
      return { ...check, judge, judgeChosenBy: "auto" as const };
    }),
  );
}

// Saves one scope's settings (the organization default or a Project), replacing
// what it customized before. A Project record left with nothing customized
// is deleted, so it inherits everything.
export async function putExperimentationHealthSettings(
  req: AuthRequest<{
    project: string;
    quality: ExperimentationHealthQualitySettings;
  }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  requireQualityScoreFeature(context);
  const { project } = req.body;
  let { quality } = req.body;
  if (!context.models.experimentationHealthSettings.canWriteScope(project)) {
    context.permissions.throwPermissionError();
  }

  if (project !== ORG_DEFAULT_SCOPE) {
    const projectDoc = await context.models.projects.getById(project);
    if (!projectDoc) {
      return res.status(404).json({
        status: 404,
        message: "Could not find that Project",
      });
    }

    if (!countHealthOverrides({ quality })) {
      const existing =
        await context.models.experimentationHealthSettings.getForScope(project);
      if (existing) {
        await context.models.experimentationHealthSettings.delete(existing);
      }
      recheckScope(context, project);
      return res.status(200).json({ status: 200, settings: null });
    }
  }

  if (quality.config?.customAiChecks?.length) {
    const saved =
      await context.models.experimentationHealthSettings.getForScope(project);
    quality = {
      ...quality,
      config: {
        ...quality.config,
        customAiChecks: await classifyCustomChecks(
          quality.config.customAiChecks,
          saved?.quality?.config?.customAiChecks ?? [],
        ),
      },
    };
  }

  const settings =
    await context.models.experimentationHealthSettings.upsertForScope(project, {
      quality,
    });
  recheckScope(context, project);
  return res.status(200).json({ status: 200, settings });
}

// "Reset all to organization defaults" for a Project
export async function deleteExperimentationHealthSettings(
  req: AuthRequest<null, null, { project: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  requireQualityScoreFeature(context);
  const existing =
    await context.models.experimentationHealthSettings.getForScope(
      req.query.project,
    );
  if (existing) {
    await context.models.experimentationHealthSettings.delete(existing);
    recheckScope(context, req.query.project);
  }
  return res.status(200).json({ status: 200 });
}
