import type { Response } from "express";
import { ExperimentationHealthQualitySettings } from "shared/validators";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ORG_DEFAULT_SCOPE } from "back-end/src/enterprise/models/ExperimentationHealthSettingsModel";

// Saves one scope's settings ("" = the organization default). A Project
// record left with nothing customized is deleted, so it inherits everything.
export async function putExperimentationHealthSettings(
  req: AuthRequest<{
    project: string;
    quality: ExperimentationHealthQualitySettings;
  }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { project, quality } = req.body;

  if (project !== ORG_DEFAULT_SCOPE) {
    const projectDoc = await context.models.projects.getById(project);
    if (!projectDoc) {
      return res.status(404).json({
        status: 404,
        message: "Could not find that Project",
      });
    }

    const hasOverrides = Object.values(quality).some((v) => v !== undefined);
    if (!hasOverrides) {
      const existing =
        await context.models.experimentationHealthSettings.getForScope(project);
      if (existing) {
        await context.models.experimentationHealthSettings.delete(existing);
      }
      return res.status(200).json({ status: 200, settings: null });
    }
  }

  const settings =
    await context.models.experimentationHealthSettings.upsertForScope(project, {
      quality,
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
