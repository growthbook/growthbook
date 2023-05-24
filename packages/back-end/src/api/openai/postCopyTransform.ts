import { Configuration, OpenAIApi } from "openai";
import { z } from "zod";
import { createApiRequestHandler } from "../../util/handler";

interface PostCopyTransformResponse {
  original: string;
  transformed: string | undefined;
  tokensRemaining: number;
}

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY || "",
});
const openai = new OpenAIApi(configuration);
const transformModes = ["energetic", "concise", "humorous"] as const;

// TODO prevent prompt injection
const getPrompt = (
  text: string,
  mode: typeof transformModes[number]
) => `Improve the following text, delimited by hypens, into a version that is more ${mode}. Keep the length of the sentence same.
---
${text}
---
`;

export const postCopyTransform = createApiRequestHandler({
  bodySchema: z
    .object({
      copy: z.string(),
      mode: z.enum(transformModes),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
})(
  async (req): Promise<PostCopyTransformResponse> => {
    const { copy, mode } = req.body;
    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: getPrompt(copy, mode),
        },
      ],
    });

    const transformed = response.data.choices[0].message?.content;

    return {
      original: copy,
      transformed,
      // TODO rate limit at 20 per day per api key
      tokensRemaining: 0,
    };
  }
);
