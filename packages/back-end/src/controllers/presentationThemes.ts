import { Response } from "express";
import { PresentationThemeInterface } from "shared/types/presentation";
import { UpdateProps } from "shared/types/base-model";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";

export async function getPresentationThemes(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);
  const themes =
    await context.models.presentationThemes.getAllSortedByUpdated();

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

  if (!context.permissions.canCreatePresentation()) {
    context.permissions.throwPermissionError();
  }

  const defaultCustomTheme = {
    backgroundColor: "#3400a3",
    textColor: "#ffffff",
    headingFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    bodyFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  };
  const theme = await context.models.presentationThemes.create({
    userId: req.userId ?? "",
    name: data.name ?? "",
    customTheme: data.customTheme ?? defaultCustomTheme,
  });

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

  const theme = await context.models.presentationThemes.getById(id);

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

  const updates: UpdateProps<PresentationThemeInterface> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.customTheme !== undefined) updates.customTheme = data.customTheme;
  const updated = await context.models.presentationThemes.updateById(
    id,
    updates,
  );

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

  const theme = await context.models.presentationThemes.getById(id);

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

  await context.models.presentationThemes.deleteById(id);

  res.status(200).json({
    status: 200,
    result: { deleted: true },
  });
}
