import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawController from "./oauth-as.controller";

const controller = wrapController(rawController);

/** Open CORS for MCP clients (third-party origins). Never mount this as app-wide middleware. */
const openCors = cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
});

const urlencoded = bodyParser.urlencoded({ extended: false });

/**
 * Public OAuth AS routes — mount BEFORE auth.middleware.
 * Discovery, DCR, token, revoke.
 * CORS is attached per-route so it cannot leak onto authenticated dashboard APIs.
 */
export const oauthAsPublicRouter = express.Router();

oauthAsPublicRouter.get(
  "/.well-known/oauth-authorization-server",
  openCors,
  controller.getAuthorizationServerMetadataHandler,
);
oauthAsPublicRouter.options("/oauth/register", openCors);
oauthAsPublicRouter.post(
  "/oauth/register",
  openCors,
  urlencoded,
  controller.postRegister,
);
oauthAsPublicRouter.options("/oauth/token", openCors);
oauthAsPublicRouter.post(
  "/oauth/token",
  openCors,
  urlencoded,
  controller.postToken,
);
oauthAsPublicRouter.options("/oauth/revoke", openCors);
oauthAsPublicRouter.post(
  "/oauth/revoke",
  openCors,
  urlencoded,
  controller.postRevoke,
);

/**
 * Authenticated OAuth AS routes — mount AFTER processJWT + requireUserId.
 * Consent helpers for the front-end authorize page.
 * Uses the app's credentialed CORS (APP_ORIGIN), not openCors.
 */
export const oauthAsAuthedRouter = express.Router();

oauthAsAuthedRouter.get(
  "/oauth/authorize/info",
  controller.getAuthorizeInfoHandler,
);
oauthAsAuthedRouter.post("/oauth/authorize", controller.postAuthorize);
oauthAsAuthedRouter.get(
  "/oauth/connected-apps",
  controller.getConnectedAppsHandler,
);
oauthAsAuthedRouter.post(
  "/oauth/connected-apps/revoke",
  controller.postRevokeConnectedApp,
);
