import uniqid from "uniqid";
import { PresentationModel } from "../models/PresentationModel";
import {
  PresentationInterface,
  PresentationSlide,
} from "../../types/presentation";
import { getExperimentsByIds } from "../models/ExperimentModel";
import { ExperimentInterface } from "../../types/experiment";
import { ExperimentSnapshotInterface } from "../../types/experiment-snapshot";
import { getLatestSnapshot } from "../models/ExperimentSnapshotModel";
import { AuthRequest } from "../types/AuthRequest";
import { userHasAccess } from "./organizations";

//import {query} from "../config/postgres";

export function getPresentationsByOrganization(organization: string) {
  return PresentationModel.find({
    organization,
  });
}

export function getPresentationById(id: string) {
  return PresentationModel.findOne({
    id,
  });
}

export async function getPresentationSnapshots(
  organization: string,
  expIds: string[],
  req: AuthRequest
) {
  const experiments = await getExperimentsByIds(
    organization,
    expIds,
    req.readAccessFilter
  );

  const withSnapshots: {
    experiment: ExperimentInterface;
    snapshot: ExperimentSnapshotInterface | null;
  }[] = [];
  const promises = experiments.map(async (experiment) => {
    // only show experiments that you have permission to view
    if (await userHasAccess(req, experiment.organization)) {
      // get best phase to show:
      const phase = experiment.phases.length - 1;
      const snapshot = await getLatestSnapshot(experiment.id, phase);
      withSnapshots.push({
        experiment,
        snapshot: snapshot ? snapshot : null,
      });
    }
  });
  await Promise.all(promises);
  // getExperimentsByIds returns experiments in any order, we want to put it
  // back into the order that was requested in the original call.
  return withSnapshots.sort((a, b) => {
    return expIds.indexOf(a.experiment.id) - expIds.indexOf(b.experiment.id);
  });
}

export async function removeExperimentFromPresentations(experiment: string) {
  const presentations = await PresentationModel.find({
    "slides.id": experiment,
  });

  await Promise.all(
    presentations.map(async (presentation) => {
      presentation.slides = presentation.slides.filter(
        (obj) => obj.id !== experiment || obj.type !== "experiment"
      );
      presentation.markModified("slides");
      await presentation.save();
    })
  );
}

export async function createPresentation(data: Partial<PresentationInterface>) {
  if (!data.slides || !data.userId || !data.organization) {
    throw new Error("Missing required presentation data");
  }

  const exps: PresentationSlide[] = [...data.slides];
  const pres: PresentationInterface = {
    slides: exps,
    title: data?.title || "",
    description: data?.description || "",
    userId: data.userId,
    organization: data.organization,
    voting: data?.voting || true,
    theme: data?.theme || "",
    id: uniqid("pres_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };
  if (data?.options) {
    pres.options = data.options;
  }
  if (data?.customTheme) {
    pres.customTheme = data.customTheme;
  }

  return PresentationModel.create(pres);
}

export function deletePresentationById(id: string) {
  return PresentationModel.deleteOne({
    id,
  });
}
