import uniqid from "uniqid";
import {
  PresentationThemeInterface,
  PresentationCustomTheme,
} from "shared/types/presentation";
import { PresentationThemeModel } from "back-end/src/models/PresentationThemeModel";

const defaultCustomTheme: PresentationCustomTheme = {
  backgroundColor: "#3400a3",
  textColor: "#ffffff",
  headingFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  bodyFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
};

export function getPresentationThemesByOrganization(organization: string) {
  return PresentationThemeModel.find({ organization }).sort({
    dateUpdated: -1,
  });
}

export function getPresentationThemeById(id: string) {
  return PresentationThemeModel.findOne({ id });
}

export async function createPresentationTheme(
  data: Partial<PresentationThemeInterface>,
) {
  if (!data.organization || !data.userId || !data.name) {
    throw new Error("Missing required presentation theme data");
  }

  const theme: PresentationThemeInterface = {
    id: uniqid("pt_"),
    organization: data.organization,
    userId: data.userId,
    name: data.name,
    customTheme: data.customTheme ?? defaultCustomTheme,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };
  if (data.transition !== undefined) theme.transition = data.transition;
  if (data.celebration !== undefined) theme.celebration = data.celebration;
  if (data.logoUrl !== undefined) theme.logoUrl = data.logoUrl;

  return PresentationThemeModel.create(theme);
}

export async function updatePresentationTheme(
  id: string,
  data: Partial<PresentationThemeInterface>,
) {
  const theme = await PresentationThemeModel.findOne({ id });
  if (!theme) return null;

  if (data.name !== undefined) theme.set("name", data.name);
  if (data.customTheme !== undefined)
    theme.set("customTheme", data.customTheme);
  if (data.transition !== undefined) theme.set("transition", data.transition);
  if (data.celebration !== undefined)
    theme.set("celebration", data.celebration);
  if (data.logoUrl !== undefined) theme.set("logoUrl", data.logoUrl);
  theme.set("dateUpdated", new Date());

  await theme.save();
  return theme;
}

export function deletePresentationThemeById(id: string) {
  return PresentationThemeModel.deleteOne({ id });
}
