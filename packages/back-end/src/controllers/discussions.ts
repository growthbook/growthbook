import { Response } from "express";
import { DiscussionParentType } from "shared/types/discussion";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  addComment,
  getDiscussionByParent,
  getLastNDiscussions,
  getProjectsByParentId,
} from "back-end/src/services/discussions";
import { getContextFromReq } from "back-end/src/services/organizations";

export async function postDiscussions(
  req: AuthRequest<
    { comment: string },
    { parentId: string; parentType: DiscussionParentType }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org, userId, email, userName } = context;

  const { parentId, parentType } = req.params;
  const { comment } = req.body;

  try {
    const projects = await getProjectsByParentId(context, parentType, parentId);

    if (!context.permissions.canAddComment(projects)) {
      context.permissions.throwPermissionError();
    }
    await addComment(
      org.id,
      parentType,
      parentId,
      { id: userId, email: email, name: userName },
      comment,
    );
    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function deleteComment(
  req: AuthRequest<
    null,
    {
      parentId: string;
      parentType: DiscussionParentType;
      index: string;
    }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { parentId, parentType, index } = req.params;

  try {
    const projects = await getProjectsByParentId(context, parentType, parentId);

    if (!context.permissions.canAddComment(projects)) {
      context.permissions.throwPermissionError();
    }

    const i = parseInt(index);

    const discussion = await getDiscussionByParent(
      org.id,
      parentType,
      parentId,
    );
    if (!discussion) {
      return res.status(404).json({
        status: 404,
        message: "Discussion not found",
      });
    }

    const current = discussion.comments[parseInt(index)];
    if (current && current?.userId !== userId) {
      return res.status(403).json({
        status: 403,
        message: "Only the original author can delete a comment",
      });
    }

    discussion.comments.splice(i, 1);
    discussion.markModified("comments");

    await discussion.save();
    return res.status(200).json({
      status: 200,
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e.message || "Error deleting comment",
    });
  }
}

export async function putComment(
  req: AuthRequest<
    { comment: string },
    {
      parentId: string;
      parentType: DiscussionParentType;
      index: string;
    }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { parentId, parentType, index } = req.params;
  const { comment } = req.body;

  try {
    const projects = await getProjectsByParentId(context, parentType, parentId);

    if (!context.permissions.canAddComment(projects)) {
      context.permissions.throwPermissionError();
    }

    const i = parseInt(index);

    const discussion = await getDiscussionByParent(
      org.id,
      parentType,
      parentId,
    );
    if (!discussion || !discussion.comments[i]) {
      return res.status(404).json({
        status: 404,
        message: "Discussion not found",
      });
    }

    const current = discussion.comments[i];
    if (current.userId !== userId) {
      return res.status(403).json({
        status: 403,
        message: "Only the original author can edit a comment",
      });
    }

    current.content = comment;
    current.edited = true;
    discussion.dateUpdated = new Date();

    discussion.markModified("comments");

    await discussion.save();
    return res.status(200).json({
      status: 200,
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message: e.message || "Error saving comment",
    });
  }
}

export async function getDiscussion(
  req: AuthRequest<
    null,
    { parentId: string; parentType: DiscussionParentType }
  >,
  res: Response,
) {
  const { org } = getContextFromReq(req);
  const { parentId, parentType } = req.params;

  try {
    const discussion = await getDiscussionByParent(
      org.id,
      parentType,
      parentId,
    );
    res.status(200).json({
      status: 200,
      discussion,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function getRecentDiscussions(
  req: AuthRequest<null, { num: string }>,
  res: Response,
) {
  const { org } = getContextFromReq(req);
  const { num } = req.params;
  let intNum = parseInt(num);
  if (intNum > 100) intNum = 100;

  try {
    // since deletes can update the dateUpdated, we want to give ourselves a bit of buffer.
    const discussions = await getLastNDiscussions(org.id, intNum + 5);

    let recent: {
      content: string;
      date: Date;
      userId: string;
      userName: string;
      userEmail: string;
      parentType: string;
      parentId: string;
    }[] = [];
    discussions.forEach((d) => {
      d.comments.forEach((c) => {
        recent.push({
          content: c.content,
          date: c.date,
          userId: c.userId,
          userName: c.userName,
          userEmail: c.userEmail,
          parentType: d.parentType,
          parentId: d.parentId,
        });
      });
    });
    recent = recent.sort((a, b) => b.date.getTime() - a.date.getTime());

    res.status(200).json({
      status: 200,
      discussions: recent.slice(0, intNum),
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}
