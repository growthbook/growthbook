import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawSampleUsersController from "./sample-users.controller";

const router = express.Router();

const sampleUsersController = wrapController(rawSampleUsersController);

router.get(
  "/",
  validateRequestMiddleware({}),
  sampleUsersController.getSampleUsers
);

router.get(
  "/eval/:id",
  validateRequestMiddleware({}),
  sampleUsersController.getSampleUsersAndEval
);

router.post(
  "/",
  validateRequestMiddleware({
    body: z.object({
      name: z.string(),
      description: z.string(),
      isPublic: z.boolean(),
      attributes: z.object({}),
    }),
  }),
  sampleUsersController.postSampleUsers
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
      attributes: z.object({}),
    }),
  }),
  sampleUsersController.putSampleUser
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
  sampleUsersController.deleteSampleUsers
);

export { router as sampleUsersRouter };
