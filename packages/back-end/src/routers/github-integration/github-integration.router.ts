import express from "express";
// import z from "zod";
import { wrapController } from "../wrapController";
// import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as _githubIntegrationController from "./github-integration.controller";

const router = express.Router();

const githubIntegrationController = wrapController(
  _githubIntegrationController
);

router.get("/", githubIntegrationController.getGitHubUserToken);

export { router as githubIntegrationRouter };
