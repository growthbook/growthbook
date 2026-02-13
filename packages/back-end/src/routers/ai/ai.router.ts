import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawAIController from "./ai.controller.js";
import { aiPromptTypeValidator, aiModelValidator } from "./ai.validators.js";

const router = express.Router();

const AIController = wrapController(rawAIController);

router.get(
  "/prompts",
  validateRequestMiddleware({}),
  AIController.getAIPrompts,
);

router.post(
  "/prompts",
  validateRequestMiddleware({
    body: z.object({
      prompts: z.array(
        z.object({
          type: aiPromptTypeValidator,
          prompt: z.string(),
          overrideModel: aiModelValidator.optional(),
        }),
      ),
    }),
  }),
  AIController.postAIPrompts,
);

router.post(
  "/reformat",
  validateRequestMiddleware({
    body: z.object({
      type: aiPromptTypeValidator,
      text: z.string(),
    }),
  }),
  AIController.postReformat,
);

export { router as aiRouter };
