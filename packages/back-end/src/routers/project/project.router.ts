import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawProjectController from "./project.controller";

const router = express.Router();

const projectController = wrapController(rawProjectController);

router.post(
  "/",
  validateRequestMiddleware({
    body: z
      .object({
        name: z.string(),
      })
      .strict(),
  }),
  projectController.postProject
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
        name: z.string(),
      })
      .strict(),
  }),
  projectController.putProject
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
  projectController.deleteProject
);

export { router as projectRouter };
