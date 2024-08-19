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
    params: z
      .object({ includeLargeSavedGroupValues: z.boolean().optional() })
      .strict(),
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
  "/:id/add-items",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
    body: z
      .object({
        items: z.array(z.string()),
        passByReferenceOnly: z.boolean().optional(),
      })
      .strict(),
  }),
  savedGroupController.postSavedGroupAddItems
);

router.post(
  "/:id/remove-items",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
    body: z
      .object({
        items: z.array(z.string()),
        passByReferenceOnly: z.boolean().optional(),
      })
      .strict(),
  }),
  savedGroupController.postSavedGroupRemoveItems
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
