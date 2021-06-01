import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { DiscussionParentType } from "../../types/discussion";
import {
  addComment,
  getDiscussionByParent,
  getLastNDiscussions,
} from "../services/discussions";
import { getFileUploadURL } from "../services/files";

export async function postDiscussions(
  req: AuthRequest<{ comment: string }>,
  res: Response
) {
  const {
    parentId,
    parentType,
  }: { parentId: string; parentType: DiscussionParentType } = req.params;
  const { comment } = req.body;

  try {
    // TODO: validate that parentType and parentId are valid for this organization

    await addComment(
      req.organization.id,
      parentType,
      parentId,
      { id: req.userId, email: req.email, name: req.name },
      comment
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

export async function deleteComment(req: AuthRequest, res: Response) {
  const {
    parentId,
    parentType,
    index,
  }: {
    parentId: string;
    parentType: DiscussionParentType;
    index: string;
  } = req.params;

  const i = parseInt(index);

  const discussion = await getDiscussionByParent(
    req.organization.id,
    parentType,
    parentId
  );
  if (!discussion) {
    return res.status(404).json({
      status: 404,
      message: "Discussion not found",
    });
  }

  const current = discussion.comments[parseInt(index)];
  if (current && current?.userId !== req.userId) {
    return res.status(403).json({
      status: 403,
      message: "Only the original author can delete a comment",
    });
  }

  discussion.comments.splice(i, 1);
  discussion.markModified("comments");

  try {
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
  req: AuthRequest<{ comment: string }>,
  res: Response
) {
  const {
    parentId,
    parentType,
    index,
  }: {
    parentId: string;
    parentType: DiscussionParentType;
    index: string;
  } = req.params;
  const { comment } = req.body;

  const i = parseInt(index);

  const discussion = await getDiscussionByParent(
    req.organization.id,
    parentType,
    parentId
  );
  if (!discussion || !discussion.comments[i]) {
    return res.status(404).json({
      status: 404,
      message: "Discussion not found",
    });
  }

  const current = discussion.comments[i];
  if (current.userId !== req.userId) {
    return res.status(403).json({
      status: 403,
      message: "Only the original author can edit a comment",
    });
  }

  current.content = comment;
  current.edited = true;
  discussion.dateUpdated = new Date();

  discussion.markModified("comments");
  try {
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

export async function getDiscussion(req: AuthRequest, res: Response) {
  const {
    parentId,
    parentType,
  }: { parentId: string; parentType: DiscussionParentType } = req.params;

  try {
    const discussion = await getDiscussionByParent(
      req.organization.id,
      parentType,
      parentId
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

export async function getRecentDiscussions(req: AuthRequest, res: Response) {
  const { num }: { num: string } = req.params;
  let intNum = parseInt(num);
  if (intNum > 100) intNum = 100;

  try {
    // since deletes can update the dateUpdated, we want to give ourselves a bit of buffer.
    const discussions = await getLastNDiscussions(
      req.organization.id,
      intNum + 5
    );

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

export async function postImageUploadUrl(req: AuthRequest, res: Response) {
  const { filetype }: { filetype: string } = req.params;

  const now = new Date();
  const { uploadURL, fileURL } = await getFileUploadURL(
    filetype,
    `${req.organization.id}/${now.toISOString().substr(0, 7)}/`
  );

  res.status(200).json({
    status: 200,
    uploadURL,
    fileURL,
  });
}
