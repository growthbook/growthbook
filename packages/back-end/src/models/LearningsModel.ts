import mongoose from "mongoose";
import { LearningInterface } from "../../types/insight";

const learningSchema = new mongoose.Schema({
  id: String,
  text: String,
  details: String,
  userId: String,
  organization: String,
  tags: [String],
  evidence: [
    {
      _id: false,
      experimentId: String,
    },
  ],
  votes: [
    {
      _id: false,
      userId: String,
      dir: Number,
      dateCreated: Date,
    },
  ],
  status: String,
  dateCreated: Date,
  dateUpdated: Date,
});

export type LearningDocument = mongoose.Document & LearningInterface;

export const LearningModel = mongoose.model<LearningDocument>(
  "Learning",
  learningSchema
);
