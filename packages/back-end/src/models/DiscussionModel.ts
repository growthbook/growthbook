import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { DiscussionInterface } from "../../types/discussion";

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

export type DiscussionDocument = mongoose.Document<
  ObjectId | undefined,
  Record<string, never>,
  DiscussionInterface
> &
  DiscussionInterface;

export const DiscussionModel = mongoose.model<DiscussionDocument>(
  "Discussion",
  discussionSchema
);
