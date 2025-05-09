import type { Response } from "express";
import { AIPromptInterface, AIPromptType } from "shared/ai";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";

type GetAIPromptResponse = {
  status: 200;
  prompts: AIPromptInterface[];
};

export async function getAIPrompts(
  req: AuthRequest,
  res: Response<GetAIPromptResponse>
) {
  const context = getContextFromReq(req);

  return res.status(200).json({
    status: 200,
    prompts: await context.models.aiPrompts.getAll(),
  });
}

export async function postAIPrompts(
  req: AuthRequest<{
    prompts: { type: AIPromptType; prompt: string }[];
  }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { prompts } = req.body;

  const currentPrompts = await context.models.aiPrompts.getAll();

  await Promise.all(
    prompts.map(async ({ type, prompt }) => {
      const existingPrompt = currentPrompts.find((p) => p.type === type);
      if (existingPrompt) {
        return context.models.aiPrompts.update(existingPrompt, { prompt });
      } else {
        return context.models.aiPrompts.create({
          type,
          prompt,
        });
      }
    })
  );

  return res.status(200).json({
    status: 200,
  });
}
