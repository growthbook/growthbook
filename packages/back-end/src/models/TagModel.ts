import mongoose from "mongoose";
import { TagInterface } from "../../types/tag";

const tagSchema = new mongoose.Schema({
  organization: {
    type: String,
    index: true,
  },
  tags: [String],
});

export type TagDocument = mongoose.Document & TagInterface;

export const TagModel = mongoose.model<TagDocument>("Tag", tagSchema);
