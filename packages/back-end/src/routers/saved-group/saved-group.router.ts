import express from "express";
import { z } from "zod";
import {
  postSavedGroupBodyValidator,
  putSavedGroupBodyValidator,
} from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawSavedGroupController from "./saved-group.controller";

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
  savedGroupController.getSavedGroup,
);

router.post(
  "/",
  validateRequestMiddleware({
    body: postSavedGroupBodyValidator,
  }),
  savedGroupController.postSavedGroup,
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
      })
      .strict(),
  }),
  savedGroupController.postSavedGroupAddItems,
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
      })
      .strict(),
  }),
  savedGroupController.postSavedGroupRemoveItems,
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
  savedGroupController.putSavedGroup,
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
  savedGroupController.deleteSavedGroup,
);

export { router as savedGroupRouter };
