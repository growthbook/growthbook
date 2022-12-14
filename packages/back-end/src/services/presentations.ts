import uniqid from "uniqid";
import { PresentationModel } from "../models/PresentationModel";
import {
  PresentationSlide,
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
