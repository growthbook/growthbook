import { PresentationModel } from "../models/PresentationModel";
import uniqid from "uniqid";
import { PresentationInterface } from "../../types/presentation";
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
    experimentIds: experiment,
  });

  await Promise.all(
    presentations.map(async (presentation) => {
      presentation.experimentIds = presentation.experimentIds.filter(
        (id) => id !== experiment
      );
      presentation.markModified("experimentIds");
      await presentation.save();
    })
  );
}

export async function createPresentation(data: Partial<PresentationInterface>) {
  return PresentationModel.create({
    // Default values that can be overridden

    // The data object passed in
    ...data,
    // Values that cannot be overridden
    id: uniqid("pres_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
}

export function deletePresentationById(id: string) {
  return PresentationModel.deleteOne({
    id,
  });
}
