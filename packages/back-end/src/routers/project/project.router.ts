import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawProjectController from "./project.controller.js";

const router = express.Router();

const projectController = wrapController(rawProjectController);

router.post(
  "/",
  validateRequestMiddleware({
    body: z
      .object({
        name: z.string(),
        description: z.string(),
      })
      .strict(),
  }),
  projectController.postProject,
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
        description: z.string(),
      })
      .strict(),
  }),
  projectController.putProject,
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
  projectController.deleteProject,
);

router.put(
  "/:id/settings",
  validateRequestMiddleware({
    body: z
      .object({
        settings: z.object({
          statsEngine: z.string().optional(),
        }),
      })
      .strict(),
  }),
  projectController.putProjectSettings,
);

export { router as projectRouter };
