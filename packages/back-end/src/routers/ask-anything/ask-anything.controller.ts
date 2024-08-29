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
  queryRequiresDOM: z.enum(["yes", "no"]),
});

export const postQuery = async (
  req: AuthRequest<{
    query: string;
    history?: { user: string; value: string; }[];
    queryContext?: any;
    path: string;
  }>,
  res: Response<any>
) => {
  const { org, userId } = getContextFromReq(req);
  // todo: permissions

  const { query, history, queryContext, path } = req.body;
  console.log({query, history, queryContext, path});

  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  // const model = openai('gpt-4-turbo');
  const model = google("models/gemini-1.5-pro-latest");

  const { object } = await generateObject({
    model,
    prompt: getPrompt(query, history, queryContext, path),
    schema: queryResponseSchema,
  });

  console.log(object)
  const response = object?.response;
  const requiresDOM = object?.queryRequiresDOM === "yes" ? true : false;

  if (!response) {
    throw new Error("Invalid response");
  }

  const result = response;

  res.status(200).json({
    result,
    requiresDOM,
  });
}


function getPrompt(query: string, history?: { user: string; value: string; }[], queryContext?: any, path: string): string {
  let prompt = `
You are an expert experimentation (AB testing) and feature flagging chat agent for the SaaS company GrowthBook.

Below is the user's query, along with context about what the user was looking at when they asked the question.
Answer to the best of your ability. Make reasonable assumptions (for instance, choosing a key metric when none is provided).
NEVER ask clarifying questions; just make an informed assumption and state which assumption you've made.

If a metric has \`inverse: true\`, then the goal of the metric is to minimize instead of maximize. For instance, "bounce-rate" might be inverse. Always respect inverse flags on metrics when analyzing how well they are performing.

If an experiment has \`regressionAdjustmentEnabled\` then CUPED is turned on.

If asking which variation is winning in an experiment, try to extrapolate a winner if the chance to win is trending in the right direction.

Plaintext responses only, no markup, markdown, or formatting tokens.

If the query requires a snapshot of the DOM (user is asking about anything UI related or likely present outside of the currently provided context), then respond with \`queryRequiresDOM: yes\`.

CUSTOMER:
\`
${query}
\`

PREVIOUS MESSAGES:
${history ? JSON.stringify(history, null, 2) : "(none)"}

CONTEXT:
\`\`\`
${queryContext ? 
    ["string", "number", "boolean"].includes(typeof queryContext) ? queryContext : JSON.stringify(queryContext, null, 2) :
    "(none provided)"}
\`\`\`
  `.trim();
  return prompt;
}
