import mongoose from "mongoose";
import { GroupInterface } from "../../types/group";

const groupSchema = new mongoose.Schema({
  organization: {
    type: String,
    index: true,
  },
  groupName: String,
  owner: String,
  dateCreated: Date,
  dateUpdated: Date,
  csv: String,
  attributeKey: String,
});

export type GroupDocument = mongoose.Document & GroupInterface;

export const GroupModel = mongoose.model<GroupDocument>("Group", groupSchema);
