import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawFeatureReviewController from "./feature-review.controller";

const router = express.Router();

const featureReviewController = wrapController(rawFeatureReviewController);

router.get(
  "/",
  validateRequestMiddleware({
    query: z
      .object({
        feature: z.string(),
      })
      .strict(),
  }),
  featureReviewController.getFeatureReviews
);

router.get(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  featureReviewController.getFeatureReview
);

router.post(
  "/",
  validateRequestMiddleware({
    body: z
      .object({
        featureId: z.string(),
        featureRevisionId: z.string(),
        description: z.string(),
        requestedUserIds: z.array(z.string()),
      })
      .strict(),
  }),
  featureReviewController.postFeatureReview
);

router.put(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
    body: z
      .object({
        // TODO:
      })
      .strict(),
  }),
  featureReviewController.putFeatureReview
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
  featureReviewController.deleteFeatureReview
);

export { router as featureReviewRouter };
