import type { Response } from "express";
import {
  ExperimentationHealthGradeWeights,
  ExperimentationHealthQualitySettings,
  ExperimentationHealthTargets,
  ORG_DEFAULT_SCOPE,
  experimentationHealthMetricKeys,
} from "shared/validators";
import { countHealthOverrides, getHealthTargetError } from "shared/enterprise";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getExperimentationHealthSummary } from "back-end/src/enterprise/services/experimentationHealth";

// Saves one scope's settings (the organization default or a Project), replacing
// what it customized before. A Project record left with nothing customized
// is deleted, so it inherits everything.
export async function putExperimentationHealthSettings(
  req: AuthRequest<{
    project: string;
    quality: ExperimentationHealthQualitySettings;
    targets?: ExperimentationHealthTargets;
    gradeWeights?: ExperimentationHealthGradeWeights;
  }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { project, quality, gradeWeights } = req.body;
  const targets =
    req.body.targets && Object.keys(req.body.targets).length
      ? req.body.targets
      : undefined;

  for (const key of experimentationHealthMetricKeys) {
    const target = targets?.[key];
    const error = target ? getHealthTargetError(key, target) : null;
    if (error) {
      return res.status(400).json({ status: 400, message: error });
    }
  }

  if (project !== ORG_DEFAULT_SCOPE) {
    const projectDoc = await context.models.projects.getById(project);
    if (!projectDoc) {
      return res.status(404).json({
        status: 404,
        message: "Could not find that Project",
      });
    }

    if (!countHealthOverrides({ quality, targets, gradeWeights })) {
      const existing =
        await context.models.experimentationHealthSettings.getForScope(project);
      if (existing) {
        await context.models.experimentationHealthSettings.delete(existing);
      }
      return res.status(200).json({ status: 200, settings: null });
    }
  }

  // Explicit undefined clears a field that is no longer customized
  const settings =
    await context.models.experimentationHealthSettings.upsertForScope(project, {
      quality,
      targets,
      gradeWeights,
    });
  return res.status(200).json({ status: 200, settings });
}

// "Reset all to organization defaults" for a Project
export async function deleteExperimentationHealthSettings(
  req: AuthRequest<null, null, { project: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const existing =
    await context.models.experimentationHealthSettings.getForScope(
      req.query.project,
    );
  if (existing) {
    await context.models.experimentationHealthSettings.delete(existing);
  }
  return res.status(200).json({ status: 200 });
}

// Current values for the Targets and Grade tabs (no project = the org)
export async function getExperimentationHealthSummaryHandler(
  req: AuthRequest<null, null, { project?: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  if (!context.hasPremiumFeature("experiment-quality-score")) {
    context.throwPlanDoesNotAllowError(
      "Your organization does not have access to Experimentation Health",
    );
  }
  const summary = await getExperimentationHealthSummary(
    context,
    req.query.project ?? ORG_DEFAULT_SCOPE,
  );
  return res.status(200).json({ status: 200, ...summary });
}
