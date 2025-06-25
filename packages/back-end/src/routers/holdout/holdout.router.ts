import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawHoldoutController from "./holdout.controller";

const router = express.Router();
const holdoutController = wrapController(rawHoldoutController);

// router.get("/", holdoutController.getHoldouts);
router.get("/:id", holdoutController.getHoldout);

export { router as holdoutRouter };
