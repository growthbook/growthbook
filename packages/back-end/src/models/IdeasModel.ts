import mongoose from "mongoose";
import { IdeaInterface } from "@/types/idea";

const ideaSchema = new mongoose.Schema({
  id: String,
  text: String,
  archived: Boolean,
  details: String,
  userId: String,
  userName: String,
  source: String,
  organization: String,
  project: String,
  tags: [String],
  votes: [
    {
      _id: false,
      userId: String,
      dir: Number,
      dateCreated: Date,
    },
  ],
  dateCreated: Date,
  dateUpdated: Date,
  impactScore: Number,
  experimentLength: Number,
  estimateParams: {
    estimate: String,
    improvement: Number,
    numVariations: Number,
    userAdjustment: Number,
  },
});
export type IdeaDocument = mongoose.Document & IdeaInterface;

export const IdeaModel = mongoose.model<IdeaInterface>("Idea", ideaSchema);
