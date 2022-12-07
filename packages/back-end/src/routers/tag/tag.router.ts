import express from "express";
import z from "zod";
import * as rawTagController from "./tag.controller";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";

const router = express.Router();

const tagController = wrapController(rawTagController);

router.post(
  "/",
  validateRequestMiddleware({
    body: z
      .object({
        id: z.string(),
        color: z.string(),
        description: z.string(),
      })
      .strict(),
  }),
  tagController.postTag
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
  tagController.deleteTag
);

export { router as tagRouter };
