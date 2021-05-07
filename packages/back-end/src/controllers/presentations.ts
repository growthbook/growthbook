import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import {
  getPresentationById,
  getPresentationsByOrganization,
  createPresentation,
  deletePresentationById,
} from "../services/presentations";
import {
  getExperimentsByIds,
  getLatestSnapshot,
} from "../services/experiments";
import { getLearningsByExperimentIds } from "../services/learnings";
import { userHasAccess } from "../services/organizations";
import { LearningInterface } from "../../types/insight";
import { ExperimentInterface } from "../../types/experiment";
import { ExperimentSnapshotInterface } from "../../types/experiment-snapshot";
import { PresentationInterface } from "../../types/presentation";

export async function getPresentations(req: AuthRequest, res: Response) {
  const presentations = await getPresentationsByOrganization(
    req.organization.id
  );

  const learnings: Record<string, LearningInterface[]> = {};

  await Promise.all(
    presentations.map(async (v) => {
      if (v.experimentIds) {
        // get the experiments to show?
        //v.experiments = await getExperimentsByIds(v.experimentIds);
        // get the learnings?
        learnings[v.id] = await getLearningsByExperimentIds(v.experimentIds);
      }
    })
  );

  res.status(200).json({
    status: 200,
    presentations,
    learnings,
  });
}

export async function getPresentation(req: AuthRequest, res: Response) {
  const { id }: { id: string } = req.params;

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
  if (pres.experimentIds) {
    expIds = pres.experimentIds;
  } else {
    // use some other way to find the experiments... perhaps by search query options.
    //TODO
  }

  const experiments = await getExperimentsByIds(pres.experimentIds);
  // was trying to push the experiments into the presentation model,
  // but that wouldn't work for some reason

  const withSnapshots: {
    experiment: ExperimentInterface;
    snapshot: ExperimentSnapshotInterface;
  }[] = [];
  const promises = experiments.map(async (experiment, i) => {
    const snapshot = await getLatestSnapshot(
      experiment.id,
      experiment.phases.length - 1
    );
    withSnapshots[i] = {
      experiment,
      snapshot,
    };
  });
  await Promise.all(promises);

  // get the learnigns associated with these experiments:
  const learnings = await getLearningsByExperimentIds(expIds);

  res.status(200).json({
    status: 200,
    presentation: pres,
    learnings,
    experiments: withSnapshots,
  });
}

export async function deletePresentation(
  req: AuthRequest<ExperimentInterface>,
  res: Response
) {
  const { id }: { id: string } = req.params;

  const p = await getPresentationById(id);

  if (!p) {
    res.status(403).json({
      status: 404,
      message: "Presentation not found",
    });
    return;
  }

  if (p.organization !== req.organization.id) {
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
  const data = req.body;
  data.organization = req.organization.id;

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
  req: AuthRequest<PresentationInterface>,
  res: Response
) {
  const { id }: { id: string } = req.params;
  const data = req.body;

  const p = await getPresentationById(id);

  if (!p) {
    res.status(403).json({
      status: 404,
      message: "Presentation not found",
    });
    return;
  }

  if (p.organization !== req.organization.id) {
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
    p.set("experimentIds", data["experimentIds"]);
    p.set("options", data["options"]);
    p.set("dateUpdated", new Date());

    await p.save();

    res.status(200).json({
      status: 200,
      presentation: p,
    });
  } catch (e) {
    console.log("caught error...");
    console.error(e);
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
}
