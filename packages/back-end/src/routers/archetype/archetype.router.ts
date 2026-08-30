import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawArchetypeController from "./archetype.controller";

const router = express.Router();

const ArchetypeController = wrapController(rawArchetypeController);

router.get(
  "/",
  validateRequestMiddleware({}),
  ArchetypeController.getArchetype,
);

router.get(
  "/eval/:id/:version",
  validateRequestMiddleware({}),
  ArchetypeController.getArchetypeAndEval,
);

router.post(
  "/",
  validateRequestMiddleware({
    body: z.object({
      name: z.string(),
      description: z.string(),
      isPublic: z.boolean(),
      attributes: z.string(),
      projects: z.array(z.string()).optional(),
    }),
  }),
  ArchetypeController.postArchetype,
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
      name: z.string(),
      description: z.string(),
      isPublic: z.boolean(),
      attributes: z.string(),
      projects: z.array(z.string()).optional(),
    }),
  }),
  ArchetypeController.putArchetype,
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
  ArchetypeController.deleteArchetype,
);

export { router as ArchetypeRouter };
