import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
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
        tokenId: z.string(),
      })
      .strict(),
  }),
  githubIntegrationController.postGithubIntegration
);

export { router as githubIntegrationRouter };
