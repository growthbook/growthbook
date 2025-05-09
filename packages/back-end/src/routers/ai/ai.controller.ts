import type { Response } from "express";
import { AIPromptInterface, AIPromptType } from "shared/ai";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { simpleCompletion } from "back-end/src/services/openai";

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

export async function postReformat(
  req: AuthRequest<{ type: AIPromptType; text: string }>,
  res: Response
) {
  const context = getContextFromReq(req);

  const prompt = await context.models.aiPrompts.getAIPrompt(req.body.type);
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
  });

  res.status(200).json({
    status: 200,
    data: {
      output: aiResults,
    },
  });
}
