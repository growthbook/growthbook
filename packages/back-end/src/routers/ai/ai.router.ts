import express from "express";
import z from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawAIController from "./ai.controller";

const router = express.Router();

const AIController = wrapController(rawAIController);

router.get(
  "/prompts",
  validateRequestMiddleware({}),
  AIController.getAIPrompts
);

router.post(
  "/prompts",
  validateRequestMiddleware({
    body: z.object({
      prompts: z.array(
        z.object({
          type: z.string(),
          prompt: z.string(),
        })
      ),
    }),
  }),

  AIController.postAIPrompts
);

export { router as aiRouter };
