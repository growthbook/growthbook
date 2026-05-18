import type { Response } from "express";
import { z } from "zod";
import { AIModel, AIPromptInterface, AIPromptType } from "shared/ai";
import {
  getAISettingsForOrg,
  getContextFromReq,
} from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  secondsUntilAICanBeUsedAgain,
  simpleCompletion,
} from "back-end/src/enterprise/services/ai";
import { getTokensUsedByOrganization } from "back-end/src/models/AITokenUsageModel";

type GetTokenUsageResponse = {
  status: 200;
  tokenUsage: {
    numTokensUsed: number;
    dailyLimit: number;
    nextResetAt: number;
  };
};

export async function getTokenUsage(
  req: AuthRequest,
  res: Response<GetTokenUsageResponse>,
) {
  const { org } = getContextFromReq(req);
  const tokenUsage = await getTokensUsedByOrganization(org);
  return res.status(200).json({
    status: 200,
    tokenUsage,
  });
}

type GetAIPromptResponse = {
  status: 200;
  prompts: AIPromptInterface[];
};

export async function getAIPrompts(
  req: AuthRequest,
  res: Response<GetAIPromptResponse>,
) {
  const context = getContextFromReq(req);

  return res.status(200).json({
    status: 200,
    prompts: await context.models.aiPrompts.getAll(),
  });
}

export async function postAIPrompts(
  req: AuthRequest<{
    prompts: { type: AIPromptType; prompt: string; overrideModel?: AIModel }[];
  }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { prompts } = req.body;

  const currentPrompts = await context.models.aiPrompts.getAll();

  await Promise.all(
    prompts.map(async ({ type, prompt, overrideModel }) => {
      const existingPrompt = currentPrompts.find((p) => p.type === type);
      if (existingPrompt) {
        return context.models.aiPrompts.update(existingPrompt, {
          prompt,
          overrideModel,
        });
      } else {
        return context.models.aiPrompts.create({
          type,
          prompt,
          overrideModel,
        });
      }
    }),
  );

  return res.status(200).json({
    status: 200,
  });
}

const checkResponseSchema = z.object({
  isCompliant: z
    .boolean()
    .describe(
      "True if the input already adheres to the format/criteria with no meaningful improvements needed.",
    ),
  feedback: z
    .string()
    .describe(
      "If not compliant, a short (1-2 sentence) plain-language explanation of what is missing or could be improved. Empty string if compliant.",
    ),
  suggestion: z
    .string()
    .describe(
      "If not compliant, a rewritten version that fully adheres to the criteria. Empty string if compliant.",
    ),
});

export async function postReformat(
  req: AuthRequest<{
    type: AIPromptType;
    text: string;
    temperature?: number;
    action?: "reformat" | "check";
  }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { aiEnabled } = getAISettingsForOrg(context);

  if (!aiEnabled) {
    return res.status(404).json({
      status: 404,
      message: "AI configuration not set or enabled",
    });
  }

  if (!req.organization) {
    return res.status(404).json({
      status: 404,
      message: "Organization not found",
    });
  }

  const secondsUntilReset = await secondsUntilAICanBeUsedAgain(
    req.organization,
  );
  if (secondsUntilReset > 0) {
    return res.status(429).json({
      status: 429,
      message: "Over AI usage limits",
      retryAfter: secondsUntilReset,
    });
  }

  const temperature = req.body.temperature ?? 0.1;
  const { prompt, isDefaultPrompt, overrideModel } =
    await context.models.aiPrompts.getAIPrompt(req.body.type);
  if (!prompt) {
    return res.status(400).json({
      status: 400,
      error: "Prompt not found",
    });
  }

  const { text, action = "reformat" } = req.body;

  if (action === "check") {
    const checkPrompt =
      `Evaluate whether the following text adheres to the criteria below.\n\n` +
      `Text:\n"${text}"\n\n` +
      `Criteria:\n${prompt}\n\n` +
      `If the text already adheres to the criteria with no meaningful improvements needed, ` +
      `set isCompliant to true and leave feedback and suggestion as empty strings. ` +
      `Otherwise, set isCompliant to false, provide brief feedback explaining what is missing or could be improved, ` +
      `and provide a rewritten suggestion that fully adheres to the criteria.`;

    const aiResults = await simpleCompletion({
      context,
      prompt: checkPrompt,
      temperature,
      type: req.body.type,
      isDefaultPrompt,
      overrideModel,
      returnType: "json",
      jsonSchema: checkResponseSchema,
    });

    let rawCheck: unknown;
    try {
      rawCheck = JSON.parse(aiResults);
    } catch {
      return res.status(500).json({
        status: 500,
        message: "Failed to parse AI response",
      });
    }
    const parsedCheck = checkResponseSchema.safeParse(rawCheck);
    if (!parsedCheck.success) {
      return res.status(500).json({
        status: 500,
        message: "AI response did not match expected shape",
      });
    }
    return res.status(200).json({
      status: 200,
      data: {
        check: parsedCheck.data,
      },
    });
  }

  const reformatPrompt = `Given the text: \n"${text}"\n\nReformat it according to the following format: ${prompt}`;
  const aiResults = await simpleCompletion({
    context,
    prompt: reformatPrompt,
    temperature,
    type: req.body.type,
    isDefaultPrompt,
    overrideModel,
  });

  res.status(200).json({
    status: 200,
    data: {
      output: aiResults,
    },
  });
}
