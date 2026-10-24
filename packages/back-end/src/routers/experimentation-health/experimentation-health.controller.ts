import type { Response } from "express";
import {
  ExperimentationHealthQualitySettings,
  ORG_DEFAULT_SCOPE,
} from "shared/validators";
import { countHealthOverrides } from "shared/enterprise";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ReqContext } from "back-end/types/request";
import { queueExperimentQualityRecheck } from "back-end/src/jobs/experimentQualityScoreQueue";
import { logger } from "back-end/src/util/logger";

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
  const { project, quality } = req.body;

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
