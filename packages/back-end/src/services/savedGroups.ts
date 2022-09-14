import { SavedGroupModel } from "../models/SavedGroupModel";

export async function getAllSavedGroups(organization: string) {
  const doc = await SavedGroupModel.find({
    organization,
  });
  if (doc) {
    return doc;
  }

  return [];
}
