/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import {getContextFromReq} from "../../services/organizations";
import { z } from "zod";
// import { openai } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from 'ai';

const queryResponseSchema = z.object({
  response: z.string(),
});

export const postQuery = async (
  req: AuthRequest<{
    query: string;
    queryContext?: any;
    path: string;
  }>,
  res: Response<any>
) => {
  const { org, userId } = getContextFromReq(req);
  // todo: permissions

  const { query, queryContext, path } = req.body;
  console.log({query, queryContext, path});

  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  // const model = openai('gpt-4-turbo');
  const model = google("models/gemini-1.5-pro-latest");

  const { object } = await generateObject({
    model,
    prompt: getPrompt(query, queryContext, path),
    schema: queryResponseSchema,
  });

  console.log(object)
  const response = object?.response;

  if (!response) {
    throw new Error("Invalid response");
  }

  const result = response;

  res.status(200).json({
    result
  });
}


function getPrompt(query: string, queryContext?: any, path: string): string {
  let prompt = `
You are an expert experimentation (AB testing) and feature flagging chat agent for the SaaS company GrowthBook.

Below is the user's query, along with context about what the user was looking at when they asked the question.
Answer to the best of your ability. Make reasonable assumptions (for instance, choosing a key metric when none is provided).
NEVER ask clarifying questions; just make an informed assumption and state which assumption you've made.

CUSTOMER:
\`
${query}
\`

CONTEXT:
\`\`\`
${queryContext ? 
    ["string", "number", "boolean"].includes(typeof queryContext) ? queryContext : JSON.stringify(queryContext, null, 2) :
    "(none provided)"}
\`\`\`
  `.trim();
  return prompt;
}
