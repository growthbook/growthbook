import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawController from "./insights.controller";

const router = express.Router();

const controller = wrapController(rawController);

router.get("/health/scores", controller.getHealthScores);

export { router as insightsRouter };
