import uniqid from "uniqid";
import { DiscussionModel } from "@/src/models/DiscussionModel";
import { Comment, DiscussionParentType } from "@/types/discussion";

export async function getDiscussionByParent(
  organization: string,
  parentType: DiscussionParentType,
  parentId: string
) {
  return await DiscussionModel.findOne({
    organization,
    parentType,
    parentId,
  });
}

export async function getAllDiscussionsByOrg(organization: string) {
  return await DiscussionModel.find({
    organization,
  });
}

export async function getAllDiscussionsByOrgFromDate(
  organization: string,
  date: Date
) {
  return await DiscussionModel.find({
    organization,
    dateUpdated: { $gte: date },
  });
}

export async function getLastNDiscussions(organization: string, num: number) {
  return await DiscussionModel.find({
    organization,
  })
    .sort({ dateUpdated: -1 })
    .limit(num);
}

export async function addComment(
  organization: string,
  parentType: DiscussionParentType,
  parentId: string,
  user: { id: string; email: string; name: string },
  comment: string
) {
  const newComment: Comment = {
    content: comment,
    date: new Date(),
    userEmail: user.email,
    userId: user.id,
    userName: user.name,
  };

  const discussion = await getDiscussionByParent(
    organization,
    parentType,
    parentId
  );
  // Comment thread already exists
  if (discussion && discussion.id) {
    discussion.comments.push(newComment);
    discussion.dateUpdated = new Date();
    discussion.markModified("comments");
    await discussion.save();
    return;
  }

  // Doesn't exist, create it
  await DiscussionModel.create({
    id: uniqid("com_"),
    organization,
    parentType,
    parentId,
    comments: [newComment],
    dateUpdated: new Date(),
  });
}
