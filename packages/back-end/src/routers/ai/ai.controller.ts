import type { Response } from "express";
import { AIPromptInterface, AIPromptType } from "shared/ai";
import {
  getAISettingsForOrg,
  getContextFromReq,
} from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  secondsUntilAICanBeUsedAgain,
  simpleCompletion,
} from "back-end/src/enterprise/services/ai";

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
    prompts: { type: AIPromptType; prompt: string; textModel?: string }[];
  }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { prompts } = req.body;

  const currentPrompts = await context.models.aiPrompts.getAll();

  await Promise.all(
    prompts.map(async ({ type, prompt, textModel }) => {
      const existingPrompt = currentPrompts.find((p) => p.type === type);
      if (existingPrompt) {
        return context.models.aiPrompts.update(existingPrompt, {
          prompt,
          textModel,
        });
      } else {
        return context.models.aiPrompts.create({
          type,
          prompt,
          textModel,
        });
      }
    }),
  );

  return res.status(200).json({
    status: 200,
  });
}

export async function postReformat(
  req: AuthRequest<{ type: AIPromptType; text: string }>,
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

  const { prompt, isDefaultPrompt, textModel } =
    await context.models.aiPrompts.getAIPrompt(req.body.type);
  if (!prompt) {
    return res.status(400).json({
      status: 400,
      error: "Prompt not found",
    });
  }

  const { text } = req.body;
  const reformatPrompt = `Given the text: \n"${text}"\n\nReformat it according to the following format: ${prompt}`;
  const aiResults = await simpleCompletion({
    context,
    prompt: reformatPrompt,
    temperature: 0.1,
    type: req.body.type,
    isDefaultPrompt,
    overrideModel: textModel,
  });

  res.status(200).json({
    status: 200,
    data: {
      output: aiResults,
    },
  });
}
