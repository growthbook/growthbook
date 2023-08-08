import mongoose from "mongoose";
import uniqid from "uniqid";
import {
  Comment,
  DiscussionInterface,
  DiscussionParentType,
} from "../../types/discussion";
import { omit } from "lodash";

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

const DiscussionModel = mongoose.model<DiscussionInterface>(
  "Discussion",
  discussionSchema
);

/**
 * Convert the Mongo document to an AuditInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface = (doc: DiscussionDocument): DiscussionInterface => {
  return omit(doc.toJSON<DiscussionDocument>(), ["__v", "_id"]);
};

type CreateDiscussionOptions = {
  organization: string;
  parentType: DiscussionParentType;
  parentId: string;
  comment: Comment;
};

export async function createDiscussion({
  organization,
  parentType,
  parentId,
  comment,
}: CreateDiscussionOptions): Promise<DiscussionInterface> {
  const discussionDoc = await DiscussionModel.create({
    id: uniqid("com_"),
    organization,
    parentType,
    parentId,
    comments: [comment],
    dateUpdated: new Date(),
  });
  return toInterface(discussionDoc);
}

export async function getDiscussionByParent(
  organization: string,
  parentType: DiscussionParentType,
  parentId: string
): Promise<DiscussionInterface | null> {
  const discussionDoc = await DiscussionModel.findOne({
    organization,
    parentType,
    parentId,
  });
  return discussionDoc ? toInterface(discussionDoc) : null;
}

export async function getAllDiscussionsByOrg(
  organization: string
): Promise<DiscussionInterface[]> {
  const discussionDoc = await DiscussionModel.find({
    organization,
  });
  return discussionDoc.map((doc) => toInterface(doc));
}

export async function getAllDiscussionsByOrgFromDate(
  organization: string,
  date: Date
): Promise<DiscussionInterface[]> {
  const discussionDoc = await DiscussionModel.find({
    organization,
    dateUpdated: { $gte: date },
  });
  return discussionDoc.map((doc) => toInterface(doc));
}

export async function getLastNDiscussions(
  organization: string,
  num: number
): Promise<DiscussionInterface[]> {
  const discussionDoc = await DiscussionModel.find({
    organization,
  })
    .sort({ dateUpdated: -1 })
    .limit(num);
  return discussionDoc.map((doc) => toInterface(doc));
}
