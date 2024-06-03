import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawEnvironmentController from "./environment.controller";

const router = express.Router();

const environmentController = wrapController(rawEnvironmentController);

router.put(
  "/",
  validateRequestMiddleware({
    body: z
      .object({
        environments: z.array(
          z
            .object({
              id: z.string(),
              description: z.string(),
              toggleOnList: z.boolean().optional(),
              defaultState: z.boolean().optional(),
              projects: z.array(z.string()).optional(),
            })
            .strict()
        ),
      })
      .strict(),
  }),
  environmentController.putEnvironments
);

router.put(
  "/order",
  validateRequestMiddleware({
    body: z
      .object({
        environments: z.array(z.string()),
      })
      .strict(),
  }),
  environmentController.putEnvironmentOrder
);

router.post(
  "/",
  validateRequestMiddleware({
    body: z
      .object({
        environment: z
          .object({
            id: z.string(),
            description: z.string(),
            toggleOnList: z.boolean().optional(),
            defaultState: z.any().optional(),
            projects: z.array(z.string()).optional(),
          })
          .strict(),
      })
      .strict(),
  }),
  environmentController.postEnvironment
);

router.put(
  "/:id",
  validateRequestMiddleware({
    body: z.object({
      environment: z
        .object({
          description: z.string(),
          toggleOnList: z.boolean().optional(),
          defaultState: z.any().optional(),
          projects: z.array(z.string()).optional(),
        })
        .strict(),
    }),
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  environmentController.putEnvironment
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
  environmentController.deleteEnvironment
);

export { router as environmentRouter };
