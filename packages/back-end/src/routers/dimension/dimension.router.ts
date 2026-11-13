import express from "express";
import { z } from "zod";
import { dimensionTimingValidator } from "shared/validators";
import { DIMENSION_NULL_LABEL_MAX_LENGTH } from "shared/constants";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawDimensionController from "./dimension.controller";

const router = express.Router();

const dimensionController = wrapController(rawDimensionController);

router.get("/", dimensionController.getDimensions);

router.post(
  "/",
  validateRequestMiddleware({
    body: z
      .object({
        datasource: z.string(),
        userIdType: z.string(),
        name: z.string(),
        sql: z.string(),
        description: z.string(),
        owner: z.string().optional(), // This is required even though it's not being used
        timing: dimensionTimingValidator.optional(),
        nullLabel: z.string().max(DIMENSION_NULL_LABEL_MAX_LENGTH).optional(),
      })
      .strict(),
  }),
  dimensionController.postDimension,
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
        datasource: z.string(),
        userIdType: z.string(),
        name: z.string(),
        sql: z.string(),
        owner: z.string(),
        description: z.string(),
        timing: dimensionTimingValidator.optional(),
        nullLabel: z.string().max(DIMENSION_NULL_LABEL_MAX_LENGTH).optional(),
      })
      .strict(),
  }),
  dimensionController.putDimension,
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
  dimensionController.deleteDimension,
);

export { router as dimensionRouter };
