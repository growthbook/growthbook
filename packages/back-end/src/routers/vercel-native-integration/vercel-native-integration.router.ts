import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawVercelController from "./vercel-native-integration.controller";
import {
  upsertInstallationPayloadValidator,
  updateInstallationValidator,
  deleteInstallationPayloadValidator,
  provisitionResourceValidator,
} from "./vercel-native-integration.validators";

const router = express.Router();

const vercelController = wrapController(rawVercelController);

router.put(
  "/v1/installations/:installation_id",
  validateRequestMiddleware({ body: upsertInstallationPayloadValidator }),
  vercelController.upsertInstallation
);

router.get(
  "/v1/installations/:installation_id",
  validateRequestMiddleware({ body: updateInstallationValidator }),
  vercelController.upsertInstallation
);

router.patch(
  "/v1/installations/:installation_id",
  validateRequestMiddleware({}),
  vercelController.upsertInstallation
);

router.delete(
  "/v1/installations/:installation_id",
  validateRequestMiddleware({ body: deleteInstallationPayloadValidator }),
  vercelController.deleteInstallation
);

router.post(
  "/v1/installations/:installation_id/resources",
  validateRequestMiddleware({ body: provisitionResourceValidator }),
  vercelController.provisionResource
);

router.get(
  "/v1/installations/:installation_id/resources/:resource_id",
  validateRequestMiddleware({}),
  vercelController.getResource
);

router.get(
  "/v1/products/:slug/plans",
  validateRequestMiddleware({}),
  vercelController.getProducts
);

export { router as vercelRouter };
