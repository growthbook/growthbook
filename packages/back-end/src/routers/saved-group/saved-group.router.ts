import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawSavedGroupController from "./saved-group.controller";

const router = express.Router();

const savedGroupController = wrapController(rawSavedGroupController);

export const postSavedGroupBodyValidator = z.object({
  groupName: z.string(),
  owner: z.string(),
  type: z.enum(["condition", "list"]),
  condition: z.string().optional(),
  attributeKey: z.string().optional(),
  values: z.string().array().optional(),
});

router.post(
  "/",
  validateRequestMiddleware({
    body: postSavedGroupBodyValidator,
  }),
  savedGroupController.postSavedGroup
);

export const putSavedGroupBodyValidator = z.object({
  groupName: z.string().optional(),
  owner: z.string().optional(),
  values: z.string().array().optional(),
  condition: z.string().optional(),
});

router.put(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
    body: putSavedGroupBodyValidator,
  }),
  savedGroupController.putSavedGroup
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
  savedGroupController.deleteSavedGroup
);

export { router as savedGroupRouter };
