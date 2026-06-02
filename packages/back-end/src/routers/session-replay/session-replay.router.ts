import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as sessionReplayControllerRaw from "./session-replay.controller";

const router = express.Router();

const sessionReplayController = wrapController(sessionReplayControllerRaw);

router.get(
  "/",
  validateRequestMiddleware({
    query: z
      .object({
        userId: z.string().optional(),
        clientKey: z.string().optional(),
        state: z.enum(["recording", "finalized", "deleted"]).optional(),
        url: z.string().optional(),
        page: z.string().optional(),
      })
      .strict(),
  }),
  sessionReplayController.listSessions,
);
router.get("/:sessionId", sessionReplayController.getSession);

export { router as sessionReplayRouter };
