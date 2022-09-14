import mongoose from "mongoose";
import { SavedGroupInterface } from "../../types/saved-group";

const savedGroupSchema = new mongoose.Schema({
  organization: {
    type: String,
    index: true,
  },
  groupName: String,
  owner: String,
  dateCreated: Date,
  dateUpdated: Date,
  group: [String],
  attributeKey: String,
});

export type SavedGroupDocument = mongoose.Document & SavedGroupInterface;

export const SavedGroupModel = mongoose.model<SavedGroupDocument>(
  "savedGroup",
  savedGroupSchema
);
