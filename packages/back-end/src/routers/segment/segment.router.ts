import express from "express";
import z from "zod";
import { validateRequestMiddleware } from "@back-end/src/routers/utils/validateRequestMiddleware";
import { wrapController } from "@back-end/src/routers//wrapController";
import * as rawSegmentController from "./segment.controller";

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
    body: z.object({
      datasource: z.string(),
      userIdType: z.string(),
      name: z.string(),
      sql: z.string(),
      description: z.string(),
    }),
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
    body: z.object({
      datasource: z.string(),
      userIdType: z.string(),
      name: z.string(),
      owner: z.string(),
      sql: z.string(),
      description: z.string(),
    }),
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
