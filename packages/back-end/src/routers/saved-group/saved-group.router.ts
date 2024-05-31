import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawSavedGroupController from "./saved-group.controller";
import {
  postSavedGroupBodyValidator,
  putSavedGroupBodyValidator,
} from "./saved-group.validators";

const router = express.Router();

const savedGroupController = wrapController(rawSavedGroupController);

router.get(
  "/",
  validateRequestMiddleware({
    params: z.object({ includeValues: z.boolean().optional() }).strict(),
  }),
  savedGroupController.getSavedGroups
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
  savedGroupController.getSavedGroup
);

router.post(
  "/",
  validateRequestMiddleware({
    body: postSavedGroupBodyValidator,
  }),
  savedGroupController.postSavedGroup
);

router.post(
  "/:id/add-members",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
    body: z.object({ members: z.array(z.string()) }).strict(),
  }),
  savedGroupController.postSavedGroupAddMembers
);

router.post(
  "/:id/remove-members",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
    body: z.object({ members: z.array(z.string()) }).strict(),
  }),
  savedGroupController.postSavedGroupRemoveMembers
);

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
