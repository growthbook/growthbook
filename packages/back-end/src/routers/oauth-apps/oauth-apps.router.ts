import express from "express";
import { z } from "zod";
import { oauthAppPropsValidator } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawOAuthAppsController from "./oauth-apps.controller";

const router = express.Router();

const oauthAppsController = wrapController(rawOAuthAppsController);

const clientIdParams = z.object({ clientId: z.string() }).strict();

router.get("/", oauthAppsController.getOAuthApps);

router.post(
  "/",
  validateRequestMiddleware({ body: oauthAppPropsValidator }),
  oauthAppsController.postOAuthApp,
);

router.put(
  "/:clientId",
  validateRequestMiddleware({
    body: oauthAppPropsValidator,
    params: clientIdParams,
  }),
  oauthAppsController.putOAuthApp,
);

router.post(
  "/:clientId/secret",
  validateRequestMiddleware({ params: clientIdParams }),
  oauthAppsController.postOAuthAppSecret,
);

router.delete(
  "/:clientId",
  validateRequestMiddleware({ params: clientIdParams }),
  oauthAppsController.deleteOAuthApp,
);

export { router as oauthAppsRouter };
