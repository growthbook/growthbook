import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as sessionReplayControllerRaw from "./session-replay.controller";

const router = express.Router();

const sessionReplayController = wrapController(sessionReplayControllerRaw);

router.get("/", sessionReplayController.listSessions);
router.get("/:sessionId", sessionReplayController.getSession);

export { router as sessionReplayRouter };
