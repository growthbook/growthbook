import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawAIController from "./ai.controller";
import {
  aiPromptTypeValidator,
  aiModelValidator,
  aiProviderValidator,
} from "./ai.validators";

const router = express.Router();

const AIController = wrapController(rawAIController);

router.get(
  "/token-usage",
  validateRequestMiddleware({}),
  AIController.getTokenUsage,
);

router.get(
  "/credentials",
  validateRequestMiddleware({}),
  AIController.getAICredentials,
);

router.put(
  "/credentials/:provider",
  validateRequestMiddleware({
    params: z.object({ provider: aiProviderValidator }),
    // No max length or format check: key formats are the providers' to change,
    // and a stale regex here would lock admins out of a valid key. The key is
    // verified against the provider before it is stored.
    body: z.object({ apiKey: z.string().min(1) }),
  }),
  AIController.putAICredential,
);

router.delete(
  "/credentials/:provider",
  validateRequestMiddleware({
    params: z.object({ provider: aiProviderValidator }),
  }),
  AIController.deleteAICredential,
);

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
