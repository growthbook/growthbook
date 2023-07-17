import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import {
  getPresentationById,
  getPresentationsByOrganization,
  createPresentation,
  deletePresentationById,
  getPresentationSnapshots,
} from "../services/presentations";
import { getOrgFromReq, userHasAccess } from "../services/organizations";
import { ExperimentInterface } from "../../types/experiment";
import { PresentationInterface } from "../../types/presentation";

export async function getPresentations(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const presentations = await getPresentationsByOrganization(org.id);

  res.status(200).json({
    status: 200,
    presentations,
  });
}

export async function getPresentation(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { id } = req.params;
  const { org } = getOrgFromReq(req);

  const pres = await getPresentationById(id);

  if (!pres) {
    res.status(403).json({
      status: 404,
      message: "Presentation not found",
    });
    return;
  }

  if (!(await userHasAccess(req, pres.organization))) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this presentation",
    });
    return;
  }

  // get the experiments to present in this presentations:
  let expIds: string[] = [];
  if (pres.slides) {
    expIds = pres.slides
      .filter((o) => o.type === "experiment")
      .map((o) => o.id);
  }

  const withSnapshots = await getPresentationSnapshots(org.id, expIds, req);

  res.status(200).json({
    status: 200,
    presentation: pres,
    experiments: withSnapshots,
  });
}

export async function getPresentationPreview(req: AuthRequest, res: Response) {
  const { expIds } = req.query as { expIds: string };
  const { org } = getOrgFromReq(req);

  if (!expIds) {
    res.status(403).json({
      status: 404,
      message: "No experiments passed",
    });
    return;
  }
  const expIdsArr = expIds.split(",");

  const withSnapshots = await getPresentationSnapshots(org.id, expIdsArr, req);

  res.status(200).json({
    status: 200,
    experiments: withSnapshots,
  });
}

export async function deletePresentation(
  req: AuthRequest<ExperimentInterface, { id: string }>,
  res: Response
) {
  req.checkPermissions("createPresentations");

  const { id } = req.params;
  const { org } = getOrgFromReq(req);

  const p = await getPresentationById(id);

  if (!p) {
    res.status(403).json({
      status: 404,
      message: "Presentation not found",
    });
    return;
  }

  if (p.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this presentation",
    });
    return;
  }

  // note: we might want to change this to change the status to
  // 'deleted' instead of actually deleting the document.
  const del = await deletePresentationById(p.id);

  res.status(200).json({
    status: 200,
    result: del,
  });
}

/**
 * Creates a new presentation
 * @param req
 * @param res
 */
export async function postPresentation(
  req: AuthRequest<Partial<PresentationInterface>>,
  res: Response
) {
  req.checkPermissions("createPresentations");

  const data = req.body;
  const { org } = getOrgFromReq(req);
  data.organization = org.id;

  data.userId = req.userId;
  const presentation = await createPresentation(data);

  res.status(200).json({
    status: 200,
    presentation,
  });
}

/**
 * Update a presentation
 * @param req
 * @param res
 */
export async function updatePresentation(
  req: AuthRequest<PresentationInterface, { id: string }>,
  res: Response
) {
  req.checkPermissions("createPresentations");

  const { id } = req.params;
  const data = req.body;
  const { org } = getOrgFromReq(req);

  const p = await getPresentationById(id);

  if (!p) {
    res.status(403).json({
      status: 404,
      message: "Presentation not found",
    });
    return;
  }

  if (p.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this presentation",
    });
    return;
  }

  try {
    // the comp above doesn't work for arrays:
    // not sure here of the best way to check
    // for changes in the arrays, so just going to save it
    if (data["title"] !== p["title"]) p.set("title", data["title"]);
    if (data["description"] !== p["description"])
      p.set("description", data["description"]);
    p.set("slides", data["slides"]);
    p.set("options", data["options"]);
    p.set("dateUpdated", new Date());
    p.set("theme", data["theme"]);
    p.set("customTheme", data["customTheme"]);

    await p.save();

    res.status(200).json({
      status: 200,
      presentation: p,
    });
  } catch (e) {
    req.log.error(e, "Error updating presentation");
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
}
