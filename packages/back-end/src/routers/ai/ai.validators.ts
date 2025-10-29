import { z } from "zod";
import { AI_PROMPT_TYPES } from "shared/ai";

export const aiPromptTypeValidator = z.enum(AI_PROMPT_TYPES);

export const aiProviderValidator = z.enum(["openai", "anthropic"]);

export const aiPromptValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    type: aiPromptTypeValidator,
    prompt: z.string(),
    modelProvider: aiProviderValidator.optional(),
    textModel: z.string().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();
