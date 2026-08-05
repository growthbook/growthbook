import express from "express";
import {
  postSSOConnectionEnforceBodyValidator,
  putSSOConnectionBodyValidator,
} from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawSSOConnectionController from "./sso-connection.controller";

const router = express.Router();

const ssoConnectionController = wrapController(rawSSOConnectionController);

router.get("/", ssoConnectionController.getSSOConnection);

router.put(
  "/",
  validateRequestMiddleware({
    body: putSSOConnectionBodyValidator,
  }),
  ssoConnectionController.putSSOConnection,
);

router.post(
  "/enforce",
  validateRequestMiddleware({
    body: postSSOConnectionEnforceBodyValidator,
  }),
  ssoConnectionController.postSSOConnectionEnforce,
);

router.delete("/", ssoConnectionController.deleteSSOConnection);

export { router as ssoConnectionRouter };
