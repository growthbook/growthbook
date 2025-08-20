import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawHoldoutController from "./holdout.controller";

const router = express.Router();
const holdoutController = wrapController(rawHoldoutController);

router.get("/", holdoutController.getHoldouts);
router.get("/:id", holdoutController.getHoldout);
router.put("/:id", holdoutController.updateHoldout);
router.post("/", holdoutController.createHoldout);
router.post("/:id/edit-status", holdoutController.editStatus);
router.delete("/:id", holdoutController.deleteHoldout);

export { router as holdoutRouter };
