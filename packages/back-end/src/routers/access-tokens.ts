import express from "express";
import asyncHandler from "express-async-handler";
import {
  deleteAccessToken,
  getAccessToken,
  getHasAccessToken,
  postAccessToken,
} from "../controllers/organizations";

const router = express.Router();

router.get("/exists", asyncHandler(getHasAccessToken));
router.get("", asyncHandler(getAccessToken));
router.post("", asyncHandler(postAccessToken));
router.delete("", asyncHandler(deleteAccessToken));

export { router as accessTokenRouter };
