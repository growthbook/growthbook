import mongoose from "mongoose";
import { DiscussionInterface } from "shared/types/discussion";

const discussionSchema = new mongoose.Schema({
  id: String,
  organization: String,
  parentType: String,
  parentId: String,
  comments: [
    {
      _id: false,
      date: Date,
      userId: String,
      userEmail: String,
      userName: String,
      content: String,
      edited: Boolean,
    },
  ],
  dateUpdated: Date,
});

export type DiscussionDocument = mongoose.Document & DiscussionInterface;

export const DiscussionModel = mongoose.model<DiscussionInterface>(
  "Discussion",
  discussionSchema,
);
