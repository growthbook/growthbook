import mongoose from "mongoose";
import { GroupInterface } from "../../types/group";

const groupSchema = new mongoose.Schema({
  organization: String,
  groups: [String],
});

export type GroupDocument = mongoose.Document & GroupInterface;

export const GroupModel = mongoose.model<GroupDocument>("Group", groupSchema);
