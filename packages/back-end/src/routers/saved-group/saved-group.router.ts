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

router.post(
  "/",
  validateRequestMiddleware({
    body: postSavedGroupBodyValidator,
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
