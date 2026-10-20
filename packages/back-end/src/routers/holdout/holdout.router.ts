import express from "express";
import { createHoldoutInputValidator } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawHoldoutController from "./holdout.controller";

const router = express.Router();
const holdoutController = wrapController(rawHoldoutController);

router.get("/", holdoutController.getHoldouts);
router.get("/:id", holdoutController.getHoldout);
router.put("/:id", holdoutController.updateHoldout);
router.post(
  "/",
  validateRequestMiddleware({ body: createHoldoutInputValidator }),
  holdoutController.createHoldout,
);
router.post("/:id/edit-status", holdoutController.editStatus);
router.delete("/:id", holdoutController.deleteHoldout);
router.delete(
  "/:id/feature/:featureId",
  holdoutController.deleteHoldoutFeature,
);

export { router as holdoutRouter };
