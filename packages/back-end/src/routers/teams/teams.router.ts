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
        description: z.string(),
        permissions: PermissionZodObject.extend({
          projectRoles: PermissionZodObject.extend({
            project: z.string(),
          }).array(),
        }),
      })
      .strict(),
  }),
  teamController.postTeam
);

// TODO: add zod validation for these routes

router.get("/:id", teamController.getTeamById);

router.delete("/:id", teamController.deleteTeamById);

router.get("/", teamController.getTeams);

router.put("/:id", teamController.updateTeam);

export { router as teamRouter };
