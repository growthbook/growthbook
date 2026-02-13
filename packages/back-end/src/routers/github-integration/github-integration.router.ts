import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as _githubIntegrationController from "./github-integration.controller.js";

const router = express.Router();

const githubIntegrationController = wrapController(
  _githubIntegrationController,
);

router.get("/", githubIntegrationController.getGithubIntegration);
router.post(
  "/",
  validateRequestMiddleware({
    body: z
      .object({
        code: z.string(),
      })
      .strict(),
  }),
  githubIntegrationController.postGithubIntegration,
);
router.post(
  "/toggle-repo",
  validateRequestMiddleware({
    body: z
      .object({
        repoId: z.string(),
      })
      .strict(),
  }),
  githubIntegrationController.postRepoWatch,
);

export { router as githubIntegrationRouter };
