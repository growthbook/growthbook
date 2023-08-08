import { Comment, DiscussionParentType } from "../../types/discussion";
import {
  createDiscussion,
  getDiscussionByParent,
} from "../models/DiscussionModel";

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
  createDiscussion({ organization, parentType, parentId, comment: newComment });
}
