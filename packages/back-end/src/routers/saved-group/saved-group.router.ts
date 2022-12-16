import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawSavedGroupController from "./saved-group.controller";

const router = express.Router();

const savedGroupController = wrapController(rawSavedGroupController);

router.post(
  "/",
  validateRequestMiddleware({
    body: z.object({
      groupName: z.string(),
      owner: z.string(),
      attributeKey: z.string(),
      groupList: z.string(),
    }),
  }),
  savedGroupController.postSavedGroup
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
      groupName: z.string(),
      owner: z.string(),
      attributeKey: z.string(),
      groupList: z.string(),
    }),
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
