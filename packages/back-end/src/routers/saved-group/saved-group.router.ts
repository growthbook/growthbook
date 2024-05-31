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
  "/:id/add-member/:mid",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
        mid: z.string(),
      })
      .strict(),
  }),
  savedGroupController.postSavedGroupAddMember
);

router.post(
  "/:id/remove-member/:mid",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
        mid: z.string(),
      })
      .strict(),
  }),
  savedGroupController.postSavedGroupRemoveMember
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
