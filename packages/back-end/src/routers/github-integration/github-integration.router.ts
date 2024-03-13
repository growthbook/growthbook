import express from "express";
import z from "zod";
import { validateRequestMiddleware } from "@/src/routers/utils/validateRequestMiddleware";
import { wrapController } from "@/src/routers//wrapController";
import * as _githubIntegrationController from "./github-integration.controller";

const router = express.Router();

const githubIntegrationController = wrapController(
  _githubIntegrationController
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
  githubIntegrationController.postGithubIntegration
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
  githubIntegrationController.postRepoWatch
);

export { router as githubIntegrationRouter };
