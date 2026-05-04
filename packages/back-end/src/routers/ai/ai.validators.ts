import { z } from "zod";
import { AI_PROMPT_TYPES, AI_PROVIDER_MODEL_MAP, AIModel } from "shared/ai";

export const aiPromptTypeValidator = z.enum(AI_PROMPT_TYPES);

// Create a tuple of all valid AI models from all providers
const allAIModels = Object.values(AI_PROVIDER_MODEL_MAP).flat() as [
  string,
  ...string[],
] as AIModel[];

export const aiModelValidator = z.enum(allAIModels);

export const aiPromptValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    type: aiPromptTypeValidator,
    prompt: z.string(),
    overrideModel: aiModelValidator.optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();
