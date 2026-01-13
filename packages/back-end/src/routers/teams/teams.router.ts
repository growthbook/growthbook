import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawTeamController from "./teams.controller";

const router = express.Router();

const teamController = wrapController(rawTeamController);

const PermissionZodObject = z.object({
  role: z.string(),
  limitAccessByEnvironment: z.boolean(),
  environments: z.string().array(),
});

router.post("/:id/members", teamController.addTeamMembers);

router.delete("/:id/member/:memberId", teamController.deleteTeamMember);

router.post(
  "/",
  validateRequestMiddleware({
    body: z
      .object({
        name: z.string(),
        description: z.string(),
        defaultProject: z.string(),
        permissions: PermissionZodObject.extend({
          projectRoles: PermissionZodObject.extend({
            project: z.string(),
          }).array(),
        }),
      })
      .strict(),
  }),
  teamController.postTeam,
);

router.put(
  "/:id",
  validateRequestMiddleware({
    body: z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
        defaultProject: z.string().optional(),
        permissions: PermissionZodObject.extend({
          projectRoles: PermissionZodObject.extend({
            project: z.string(),
          })
            .array()
            .optional(),
        }),
      })
      .strict(),
  }),
  teamController.updateTeam,
);

router.delete("/:id", teamController.deleteTeamById);

export { router as teamRouter };
