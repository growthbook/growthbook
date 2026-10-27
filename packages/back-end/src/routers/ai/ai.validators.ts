import { z } from "zod";
import {
  AI_PROMPT_TYPES,
  AI_PROVIDER_MODEL_MAP,
  AI_PROVIDERS,
  BuiltInAIModel,
} from "shared/ai";

export const aiPromptTypeValidator = z.enum(AI_PROMPT_TYPES);

export const aiProviderValidator = z.enum(AI_PROVIDERS);

const allAIModels = Object.values(AI_PROVIDER_MODEL_MAP).flat() as [
  BuiltInAIModel,
  ...BuiltInAIModel[],
];

export const aiModelValidator = z.union([
  z.enum(allAIModels),
  z.templateLiteral(["custom:", z.enum(AI_PROVIDERS), ":", z.string().min(1)]),
]);

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
