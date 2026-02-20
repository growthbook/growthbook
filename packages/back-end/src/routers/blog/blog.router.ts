import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawBlogController from "./blog.controller";

const router = express.Router();

const blogController = wrapController(rawBlogController);

router.get("/recent", blogController.getRecentBlogPosts);

export { router as blogRouter };
