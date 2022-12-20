import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
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
        owner: z.string().optional(), // This is required even though it's not being used
      })
      .strict(),
  }),
  dimensionController.postDimension
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
      })
      .strict(),
  }),
  dimensionController.putDimension
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
  dimensionController.deleteDimension
);

export { router as dimensionRouter };
