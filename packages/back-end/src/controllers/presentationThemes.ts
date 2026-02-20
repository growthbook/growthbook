import { Response } from "express";
import { PresentationThemeInterface } from "shared/types/presentation";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getPresentationThemesByOrganization,
  getPresentationThemeById,
  createPresentationTheme,
  updatePresentationTheme,
  deletePresentationThemeById,
} from "back-end/src/services/presentationThemes";
import { getContextFromReq } from "back-end/src/services/organizations";

export async function getPresentationThemes(req: AuthRequest, res: Response) {
  const { org } = getContextFromReq(req);
  const themes = await getPresentationThemesByOrganization(org.id);

  res.status(200).json({
    status: 200,
    themes,
  });
}

export async function postPresentationTheme(
  req: AuthRequest<Partial<PresentationThemeInterface>>,
  res: Response,
) {
  const data = req.body;
  const context = getContextFromReq(req);
  const { org } = context;

  if (!context.permissions.canCreatePresentation()) {
    context.permissions.throwPermissionError();
  }

  data.organization = org.id;
  data.userId = req.userId;

  const theme = await createPresentationTheme(data);

  res.status(200).json({
    status: 200,
    theme,
  });
}

export async function putPresentationTheme(
  req: AuthRequest<Partial<PresentationThemeInterface>, { id: string }>,
  res: Response,
) {
  const { id } = req.params;
  const data = req.body;
  const context = getContextFromReq(req);
  const { org } = context;

  if (!context.permissions.canUpdatePresentation()) {
    context.permissions.throwPermissionError();
  }

  const theme = await getPresentationThemeById(id);

  if (!theme) {
    return res.status(404).json({
      status: 404,
      message: "Presentation theme not found",
    });
  }

  if (theme.organization !== org.id) {
    return res.status(403).json({
      status: 403,
      message: "You do not have access to this theme",
    });
  }

  const updated = await updatePresentationTheme(id, data);

  res.status(200).json({
    status: 200,
    theme: updated,
  });
}

export async function deletePresentationTheme(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const { id } = req.params;
  const context = getContextFromReq(req);
  const { org } = context;

  if (!context.permissions.canDeletePresentation()) {
    context.permissions.throwPermissionError();
  }

  const theme = await getPresentationThemeById(id);

  if (!theme) {
    return res.status(404).json({
      status: 404,
      message: "Presentation theme not found",
    });
  }

  if (theme.organization !== org.id) {
    return res.status(403).json({
      status: 403,
      message: "You do not have access to this theme",
    });
  }

  await deletePresentationThemeById(id);

  res.status(200).json({
    status: 200,
    result: { deleted: true },
  });
}
