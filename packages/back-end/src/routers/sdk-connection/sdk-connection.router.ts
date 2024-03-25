import express from "express";
import { wrapController } from "@back-end/src/routers//wrapController";
import * as rawSDKConnectionController from "./sdk-connection.controller";

const router = express.Router();

const sdkConnectionController = wrapController(rawSDKConnectionController);

router.get("/", sdkConnectionController.getSDKConnections);

router.post("/", sdkConnectionController.postSDKConnection);

router.put("/:id", sdkConnectionController.putSDKConnection);

router.delete("/:id", sdkConnectionController.deleteSDKConnection);

router.post(
  "/:id/check-proxy",
  sdkConnectionController.checkSDKConnectionProxyStatus
);

export { router as sdkConnectionRouter };
