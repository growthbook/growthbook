import { SavedGroupModel } from "../models/SavedGroupModel";

export async function getAllSavedGroups(organization: string) {
  const doc = await SavedGroupModel.find({
    organization,
  });
  if (doc) {
    return doc; //TODO: Come back and figure out why this is failing when I try to revert back to doc.groups.
  }

  return [];
}
