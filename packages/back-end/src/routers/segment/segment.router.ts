import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawSegmentController from "./segment.controller";
import {
  createSegmentValidator,
  updateSegmentValidator,
} from "./segment.validators";

const router = express.Router();

const segmentController = wrapController(rawSegmentController);

router.get("/", segmentController.getSegments);

router.get(
  "/:id/usage",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  segmentController.getSegmentUsage
);

router.post(
  "/",
  validateRequestMiddleware({
    body: createSegmentValidator,
  }),
  segmentController.postSegment
);

router.put(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
    body: updateSegmentValidator,
  }),
  segmentController.putSegment
);

router.delete(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  segmentController.deleteSegment
);

export { router as segmentRouter };
