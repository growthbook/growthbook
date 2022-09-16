import express from "express";
import {
  deleteComment,
  getDiscussion,
  getRecentDiscussions,
  postDiscussions,
  postImageUploadUrl,
  putComment,
} from "../controllers/discussions";

const router = express.Router();

router.get("/discussion/:parentType/:parentId", getDiscussion);
router.post("/discussion/:parentType/:parentId", postDiscussions);
router.put("/discussion/:parentType/:parentId/:index", putComment);
router.delete("/discussion/:parentType/:parentId/:index", deleteComment);
router.get("/discussions/recent/:num", getRecentDiscussions);
router.post("/file/upload/:filetype", postImageUploadUrl);

export { router as discussionsRouter };
