import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawTeamController from "./teams.controller";

const router = express.Router();

const teamController = wrapController(rawTeamController);

const PermissionZodObject = z.object({
  role: z.string(),
  limitAccessByEnvironment: z.boolean(),
  environments: z.string().array(),
});

router.post(
  "/",
  validateRequestMiddleware({
    body: z
      .object({
        name: z.string(),
        createdBy: z.string(),
        description: z.string(),
        permissions: PermissionZodObject.extend({
          projectRoles: PermissionZodObject.extend({
            project: z.string(),
          }),
        }),
      })
      .strict(),
  }),
  teamController.postTeam
);

export { router as teamRouter };
