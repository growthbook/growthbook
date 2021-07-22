import { PresentationModel } from "../models/PresentationModel";
import uniqid from "uniqid";
import {
  PresentationExperiment,
  PresentationInterface,
} from "../../types/presentation";
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

export async function removeExperimentFromPresentations(experiment: string) {
  const presentations = await PresentationModel.find({
    "experiments.id": experiment,
  });

  await Promise.all(
    presentations.map(async (presentation) => {
      presentation.experiments = presentation.experiments.filter(
        (obj) => obj.id !== experiment
      );
      presentation.markModified("experiments");
      await presentation.save();
    })
  );
}

export async function createPresentation(data: Partial<PresentationInterface>) {
  const exps: PresentationExperiment[] = [...data.experiments];
  const pres: PresentationInterface = {
    experiments: exps,
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
