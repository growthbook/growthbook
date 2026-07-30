import {
  generateText,
  streamText,
  embed,
  Output,
  tool as aiTool,
  stepCountIs,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
} from "ai";
import type { ToolSet, ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createXai } from "@ai-sdk/xai";
import { createMistral } from "@ai-sdk/mistral";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  encoding_for_model,
  get_encoding,
  TiktokenModel,
} from "@dqbd/tiktoken";
import {
  AIModel,
  AIPromptType,
  getProviderFromModel,
  getProviderFromEmbeddingModel,
  isReasoningModel,
} from "shared/ai";
import { z, ZodObject, ZodRawShape } from "zod";
import { OrganizationInterface } from "shared/types/organization";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";
import {
  getTokensUsedByOrganization,
  updateTokenUsage,
} from "back-end/src/models/AITokenUsageModel";
import { ApiReqContext } from "back-end/types/api";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { logCloudAIUsage } from "back-end/src/services/licenseServerManagedClickhouse";
import { IS_CLOUD } from "back-end/src/util/secrets";

export const getAIProviderClass = (
  context: ReqContext | ApiReqContext,
  model: AIModel,
):
  | ReturnType<typeof createAnthropic>
  | ReturnType<typeof createOpenAI>
  | ReturnType<typeof createXai>
  | ReturnType<typeof createMistral>
  | ReturnType<typeof createGoogleGenerativeAI> => {
  const {
    aiEnabled,
    openAIAPIKey,
    anthropicAPIKey,
    xaiAPIKey,
    mistralAPIKey,
    googleAPIKey,
  } = getAISettingsForOrg(context, true);

  if (!aiEnabled) {
    throw new Error(
      "AI is not enabled for this organization. Visit Settings → AI Settings to enable it.",
    );
  }

  const selectedProvider = getProviderFromModel(model);

  if (selectedProvider === "anthropic") {
    if (!anthropicAPIKey) {
      throw new Error("ANTHROPIC_API_KEY is not set.");
    }
    return createAnthropic({
      apiKey: anthropicAPIKey,
    });
  } else if (selectedProvider === "xai") {
    if (!xaiAPIKey) {
      throw new Error("XAI_API_KEY is not set.");
    }
    return createXai({
      apiKey: xaiAPIKey,
    });
  } else if (selectedProvider === "mistral") {
    if (!mistralAPIKey) {
      throw new Error("MISTRAL_API_KEY is not set.");
    }
    return createMistral({
      apiKey: mistralAPIKey,
    });
  } else if (selectedProvider === "google") {
    if (!googleAPIKey) {
      throw new Error("GOOGLE_AI_API_KEY is not set.");
    }
    return createGoogleGenerativeAI({
      apiKey: googleAPIKey,
    });
  } else {
    if (!openAIAPIKey) {
      throw new Error("OPENAI_API_KEY is not set.");
    }
    return createOpenAI({
      apiKey: openAIAPIKey,
    });
  }
};

/**
 * The docs say OpenAI might not always return token usage info in rare edge cases.
 * So this is a fallback, so we can keep track of token usage on cloud regardless.
 */
const numTokensFromMessages = (messages: ModelMessage[], model: AIModel) => {
  logger.warn("Calculating token usage from messages as fallback");
  // Use tiktoken for OpenAI models
  let encoding;
  try {
    encoding = encoding_for_model(model as TiktokenModel);
  } catch (e) {
    logger.warn(`services/ai - Could not find encoding for model: ${model}`);
    encoding = get_encoding("cl100k_base");
  }

  let numTokens = 0;
  for (const message of messages) {
    numTokens += 4;
    const { content } = message;
    if (typeof content === "string") {
      numTokens += encoding.encode(content).length;
    } else if (Array.isArray(content)) {
      // Multimodal content: only text parts are token-encodable here.
      // Image/file parts are counted by the provider's own usage; this
      // fallback under-counts them slightly, which is acceptable for the
      // rare cloud edge case where `usage` is missing.
      for (const part of content) {
        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "text" &&
          typeof part.text === "string"
        ) {
          numTokens += encoding.encode(part.text).length;
        }
      }
    }
  }

  numTokens += 2;

  return numTokens;
};

export const secondsUntilAICanBeUsedAgain = async (
  organization: OrganizationInterface,
) => {
  const { numTokensUsed, dailyLimit, nextResetAt } =
    await getTokensUsedByOrganization(organization);
  return numTokensUsed > dailyLimit
    ? (nextResetAt - new Date().getTime()) / 1000
    : 0;
};

const constructMessages = (
  prompt: string,
  instructions?: string,
  // Optional image inputs for vision models. When present, the user
  // message becomes a content-part array (images first, then the text
  // prompt) instead of a bare string. Base64-encoded, no data: prefix.
  images?: Array<{ data: string; mimeType: string }>,
): ModelMessage[] => {
  const messages: ModelMessage[] = [];

  if (instructions) {
    messages.push({
      role: "system",
      content: instructions,
    });
  }

  if (images && images.length > 0) {
    messages.push({
      role: "user",
      content: [
        ...images.map((img) => ({
          type: "image" as const,
          image: Buffer.from(img.data, "base64"),
          mediaType: img.mimeType,
        })),
        { type: "text" as const, text: prompt },
      ],
    });
  } else {
    messages.push({
      role: "user",
      content: prompt,
    });
  }

  return messages;
};

export const simpleCompletion = async ({
  context,
  instructions,
  prompt,
  temperature,
  type,
  isDefaultPrompt,
  returnType = "text",
  jsonSchema,
  overrideModel,
}: {
  context: ReqContext | ApiReqContext;
  instructions?: string;
  prompt: string;
  temperature?: number;
  type: AIPromptType;
  isDefaultPrompt: boolean;
  returnType?: "text" | "json";
  jsonSchema?: ZodObject<ZodRawShape>;
  overrideModel?: AIModel;
}) => {
  const { defaultAIModel } = getAISettingsForOrg(context, true);

  const model = overrideModel || defaultAIModel;

  const aiProvider = getAIProviderClass(context, model);

  if (aiProvider == null) {
    throw new Error("AI provider not enabled or key not set");
  }

  const messages = constructMessages(prompt, instructions);

  // Reasoning models reject `temperature`; omit it rather than let the
  // provider warn and drop it.
  const effectiveTemperature = isReasoningModel(model)
    ? undefined
    : temperature;

  const generateOptions = {
    model: aiProvider(model) as Parameters<typeof generateText>[0]["model"],
    messages,
    ...(effectiveTemperature != null
      ? { temperature: effectiveTemperature }
      : {}),
  };

  let numTokensUsed: number | undefined;
  let inputTokensUsed: number | undefined;
  let outputTokensUsed: number | undefined;
  let result: string;

  if (returnType === "json" && jsonSchema) {
    const objectResponse = await generateText({
      ...generateOptions,
      output: Output.object({
        schema: jsonSchema,
      }),
    });
    numTokensUsed = objectResponse.usage?.totalTokens;
    result = JSON.stringify(objectResponse.output);
    inputTokensUsed = objectResponse.usage?.inputTokens;
    outputTokensUsed = objectResponse.usage?.outputTokens;
  } else {
    const textResponse = await generateText(generateOptions);
    numTokensUsed = textResponse.usage?.totalTokens;
    result = textResponse.text;
    inputTokensUsed = textResponse.usage?.inputTokens;
    outputTokensUsed = textResponse.usage?.outputTokens;
  }

  if (IS_CLOUD) {
    if (!numTokensUsed) {
      numTokensUsed = numTokensFromMessages(messages, model);
    }
    await updateTokenUsage({ numTokensUsed, organization: context.org });

    // Fire and forget
    logCloudAIUsage({
      organization: context.org.id,
      type,
      model,
      numPromptTokensUsed: inputTokensUsed,
      numCompletionTokensUsed: outputTokensUsed,
      temperature: effectiveTemperature,
      usedDefaultPrompt: isDefaultPrompt,
    });
  }

  return result;
};

export const streamingChatCompletion = async ({
  context,
  system,
  messages,
  temperature,
  type,
  isDefaultPrompt,
  overrideModel,
  tools,
  maxSteps = 1,
  abortSignal,
}: {
  context: ReqContext | ApiReqContext;
  system: string;
  messages: ModelMessage[];
  temperature?: number;
  type: AIPromptType;
  isDefaultPrompt: boolean;
  overrideModel?: AIModel;
  tools?: ToolSet;
  maxSteps?: number;
  abortSignal?: AbortSignal;
}) => {
  const { defaultAIModel } = getAISettingsForOrg(context, true);
  const model = overrideModel || defaultAIModel;
  const aiProvider = getAIProviderClass(context, model);

  if (aiProvider == null) {
    throw new Error("AI provider not enabled or key not set");
  }

  // Reasoning models reject `temperature`; omit it rather than let the
  // provider warn and drop it.
  const effectiveTemperature = isReasoningModel(model)
    ? undefined
    : temperature;

  const result = streamText({
    model: aiProvider(model) as Parameters<typeof streamText>[0]["model"],
    system,
    messages,
    ...(effectiveTemperature != null
      ? { temperature: effectiveTemperature }
      : {}),
    ...(tools ? { tools, stopWhen: stepCountIs(maxSteps) } : {}),
    ...(abortSignal ? { abortSignal } : {}),
    onFinish: async ({ usage }) => {
      if (IS_CLOUD) {
        const numTokensUsed = usage?.totalTokens ?? 0;
        if (numTokensUsed) {
          await updateTokenUsage({ numTokensUsed, organization: context.org });
        }

        logCloudAIUsage({
          organization: context.org.id,
          type,
          model,
          numPromptTokensUsed: usage?.inputTokens,
          numCompletionTokensUsed: usage?.outputTokens,
          temperature: effectiveTemperature,
          usedDefaultPrompt: isDefaultPrompt,
        });
      }
    },
  });

  return result;
};

export { aiTool };

export const parsePrompt = async <T extends ZodObject<ZodRawShape>>({
  context,
  instructions,
  prompt,
  temperature,
  type,
  isDefaultPrompt,
  zodObjectSchema,
  overrideModel,
  images,
  tools,
  maxSteps = 1,
  cacheSystemPrompt = false,
  onStepFinish,
  retryOnNoObject = true,
  maxOutputTokens = 8000,
  logContext,
}: {
  context: ReqContext | ApiReqContext;
  instructions?: string;
  prompt: string;
  temperature?: number;
  type: AIPromptType;
  isDefaultPrompt: boolean;
  zodObjectSchema: T;
  overrideModel?: AIModel;
  // Optional image inputs for vision-capable models. Threaded into the
  // user message as content parts. The caller is responsible for picking
  // a vision-capable `overrideModel` (see pickVisionModel in shared/ai).
  images?: Array<{ data: string; mimeType: string }>;
  // Retry once on NoObjectGeneratedError. Pass false from callers that
  // are themselves a retry so attempts don't stack (e.g. postAIEdit's
  // selector-correction retry — otherwise one request could fan out to
  // 4 LLM calls).
  retryOnNoObject?: boolean;
  // Cap on GENERATED (output) tokens. Set explicitly because an un-capped
  // call relies on the provider default (~4k for Anthropic), and a large
  // response — e.g. a full global-CSS replacement, where the model must
  // re-emit all existing CSS — can blow past it and get truncated
  // mid-JSON, which surfaces as NoObjectGeneratedError ("couldn't format a
  // valid response"). 8000 stays under every current provider's ceiling;
  // callers that emit large artifacts (Figma → Variant) can raise it.
  maxOutputTokens?: number;
  // Extra fields merged into the NoObjectGeneratedError diagnostic logs so
  // callers can attach request-specific context (e.g. the visual editor's
  // picked-element selectors) for correlating which inputs trip the
  // structured-output failure. Diagnostic only — never affects the model.
  logContext?: Record<string, unknown>;
  // Optional tool-calling: when present, the model may emit tool calls
  // across up to `maxSteps` LLM round-trips before producing the final
  // structured output. Default of 1 keeps the no-tools shape identical.
  tools?: ToolSet;
  maxSteps?: number;
  // Mark the system message as cacheable on providers that honor an
  // explicit cache breakpoint (Anthropic). OpenAI and Google cache
  // automatically based on prefix, so this flag is a no-op for them.
  // Cache TTL is ~5 minutes; back-to-back chat turns benefit, idle
  // sessions don't.
  cacheSystemPrompt?: boolean;
  // Per-step telemetry hook — fires after each LLM round-trip in a
  // tool-calling loop. Useful for logging which tools the model picked
  // and how many steps a turn used.
  onStepFinish?: Parameters<typeof generateText>[0]["onStepFinish"];
}): Promise<z.infer<T>> => {
  const { defaultAIModel } = getAISettingsForOrg(context, true);
  const model = overrideModel || defaultAIModel;

  const aiProvider = getAIProviderClass(context, model);

  if (aiProvider == null) {
    throw new Error("AI provider not enabled or key not set");
  }

  if (!zodObjectSchema) {
    throw new Error(
      "a Zod Object for the JSON schema is required for structuredPrompt.",
    );
  }

  const messages = constructMessages(prompt, instructions, images);

  // Attach a provider-specific cache breakpoint to the system message
  // when requested. Anthropic charges ~10% of input cost for cached
  // tokens on hit — for a multi-step tool-calling loop where the system
  // prompt is large and re-sent N times, this is the difference between
  // tool calling being roughly cost-neutral vs N× more expensive than
  // single-shot.
  if (cacheSystemPrompt && instructions) {
    const sys = messages.find((m) => m.role === "system");
    if (sys) {
      sys.providerOptions = {
        anthropic: { cacheControl: { type: "ephemeral" } },
      };
    }
  }

  // Reasoning models reject `temperature`; omit it rather than let the
  // provider warn and drop it.
  const effectiveTemperature = isReasoningModel(model)
    ? undefined
    : temperature;

  const generateOnce = async () => {
    const result = await generateText({
      model: aiProvider(model) as Parameters<typeof generateText>[0]["model"],
      messages: messages,
      output: Output.object({
        schema: zodObjectSchema,
      }),
      maxOutputTokens,
      ...(effectiveTemperature != null
        ? { temperature: effectiveTemperature }
        : {}),
      ...(tools
        ? {
            tools,
            stopWhen: stepCountIs(maxSteps),
            // Force a final answer on the last allowed step. Otherwise a model
            // that keeps calling tools until it exhausts maxSteps ends ON a
            // tool call (finishReason !== "stop"), so no output object is
            // produced and the run fails with NoOutputGeneratedError (observed
            // with claude-haiku-4-5 on visual-editor moves). Forbidding tools
            // on the final step makes it commit to the structured output using
            // whatever it has gathered. Only fires on a runaway loop — a model
            // that answers within budget never reaches this step.
            prepareStep: ({ stepNumber }: { stepNumber: number }) =>
              stepNumber >= maxSteps - 1 ? { toolChoice: "none" as const } : {},
          }
        : {}),
      ...(onStepFinish ? { onStepFinish } : {}),
    });
    // Read the lazy `output` getter HERE, inside this awaited function, so the
    // try/catch below catches BOTH generation failures. generateText only
    // parses the object (and throws NoObjectGeneratedError) when the run ends
    // on "stop"; when it ends on a tool call it RESOLVES normally with no
    // output, and the getter throws NoOutputGeneratedError only on access.
    // Touching it here routes that lazy throw through the same retry path
    // instead of letting it escape at the call site as an opaque error.
    return { output: result.output, usage: result.usage };
  };

  // Output.object steers the model toward the schema but doesn't
  // grammar-constrain it, so conformance is probabilistic: a complex
  // schema, a smaller model, or mixing in tools + multi-step all raise
  // the chance it returns something the schema rejects
  // (NoObjectGeneratedError). It's almost always transient, so retry
  // once before surfacing a clear error. The durable fix for a high
  // rate is a simpler schema or a stronger model; this is just a cheap
  // backstop. A failed attempt still bills tokens (the error carries its
  // usage), so track them or the retry under-counts on Cloud.
  // Two distinct generation failures share this retry path:
  //   - NoObjectGeneratedError: the model produced text that didn't validate
  //     against the schema (truncated mid-JSON, or invalid/prose output).
  //   - NoOutputGeneratedError: with tools + multi-step, the run ENDED without
  //     ever emitting the output object (e.g. it stopped on a tool call, or
  //     returned only prose). The SDK surfaces this as a bare error with no
  //     finishReason/text/usage. Left unhandled it escaped as an opaque
  //     "No output generated." 400 — no retry, no friendly message, no log.
  const isGenerationFailure = (
    e: unknown,
  ): e is NoObjectGeneratedError | NoOutputGeneratedError =>
    NoObjectGeneratedError.isInstance(e) ||
    NoOutputGeneratedError.isInstance(e);

  // Pull whatever diagnostics the error carries so prod logs show WHY it
  // failed. Only NoObjectGeneratedError has finishReason ("length" =
  // truncated mid-JSON vs "stop" = invalid/prose) and the raw text sample;
  // NoOutputGeneratedError carries just a cause, so guard those reads.
  const noOutputDiag = (e: NoObjectGeneratedError | NoOutputGeneratedError) => {
    const objErr = NoObjectGeneratedError.isInstance(e) ? e : undefined;
    return {
      // Spread caller context FIRST so the authoritative error fields below
      // always win — a colliding logContext key can't mask the real signal.
      ...(logContext ?? {}),
      errorType: objErr ? "no-object" : "no-output",
      finishReason: objErr?.finishReason,
      cause: e.cause instanceof Error ? e.cause.message : String(e.cause ?? ""),
      textSample: (objErr?.text ?? "").slice(0, 2000),
    };
  };

  // usage is only present on NoObjectGeneratedError; NoOutputGeneratedError
  // bills nothing extra to track.
  const failureTokens = (e: NoObjectGeneratedError | NoOutputGeneratedError) =>
    NoObjectGeneratedError.isInstance(e) ? (e.usage?.totalTokens ?? 0) : 0;

  let retriedTokens = 0;
  let response: Awaited<ReturnType<typeof generateOnce>>;
  try {
    response = await generateOnce();
  } catch (err) {
    if (!isGenerationFailure(err)) throw err;
    // Don't stack retries when the caller is already a retry path.
    if (!retryOnNoObject) throw err;
    retriedTokens += failureTokens(err);
    logger.warn(
      { type, model, ...noOutputDiag(err) },
      "parsePrompt: model returned no usable output; retrying once",
    );
    try {
      response = await generateOnce();
    } catch (retryErr) {
      if (!isGenerationFailure(retryErr)) throw retryErr;
      retriedTokens += failureTokens(retryErr);
      logger.warn(
        { type, model, ...noOutputDiag(retryErr) },
        "parsePrompt: model returned no usable output after retry; giving up",
      );
      // Bill both failed attempts before surfacing the error so Cloud
      // rate-limiting doesn't under-count a double failure.
      if (IS_CLOUD && retriedTokens > 0) {
        await updateTokenUsage({
          numTokensUsed: retriedTokens,
          organization: context.org,
        });
      }
      // If either attempt stopped on the output-token ceiling, the JSON was
      // cut off mid-stream — a generic "try again" won't help an inherently
      // too-large response, so point the user at narrowing the request.
      const truncated =
        (NoObjectGeneratedError.isInstance(err) &&
          err.finishReason === "length") ||
        (NoObjectGeneratedError.isInstance(retryErr) &&
          retryErr.finishReason === "length");
      throw new Error(
        truncated
          ? "Your request produced a response too large to return in one piece. Try a more focused request — for example, edit one section or a few elements at a time, then layer on more."
          : "The AI couldn't format a valid response for this request. Please try again, or rephrase/simplify the request.",
      );
    }
  }

  if (IS_CLOUD) {
    // Fire and forget
    logCloudAIUsage({
      organization: context.org.id,
      type,
      model: model,
      numPromptTokensUsed: response.usage?.inputTokens,
      numCompletionTokensUsed: response.usage?.outputTokens,
      temperature: effectiveTemperature,
      usedDefaultPrompt: isDefaultPrompt,
    });

    const numTokensUsed =
      (response.usage?.totalTokens ?? numTokensFromMessages(messages, model)) +
      retriedTokens;
    await updateTokenUsage({ numTokensUsed, organization: context.org });
  }

  if (!response.output) {
    throw new Error("No output returned from AI API.");
  }
  return response.output as z.infer<T>;
};

export function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error("Vectors must be of the same length");
  }
  const dot = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
  const normA = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  return dot / (normA * normB);
}

export async function generateEmbeddings({
  context,
  input,
}: {
  context: ReqContext | ApiReqContext;
  input: string[];
}): Promise<number[][]> {
  const {
    aiEnabled,
    openAIAPIKey,
    mistralAPIKey,
    googleAPIKey,
    embeddingModel,
  } = getAISettingsForOrg(context, true);

  if (!aiEnabled) {
    throw new Error("AI features are not enabled");
  }

  // Get the provider for this embedding model
  const provider = getProviderFromEmbeddingModel(embeddingModel);

  // Check that we have the API key for this provider
  let aiProvider;
  if (provider === "openai") {
    if (!openAIAPIKey) {
      throw new Error("OpenAI API key not set");
    }
    aiProvider = createOpenAI({
      apiKey: openAIAPIKey,
    });
  } else if (provider === "mistral") {
    if (!mistralAPIKey) {
      throw new Error("Mistral API key not set");
    }
    aiProvider = createMistral({
      apiKey: mistralAPIKey,
    });
  } else if (provider === "google") {
    if (!googleAPIKey) {
      throw new Error("Google AI API key not set");
    }
    aiProvider = createGoogleGenerativeAI({
      apiKey: googleAPIKey,
    });
  } else {
    throw new Error(`Unsupported embedding provider: ${provider}`);
  }

  try {
    const model = aiProvider.embedding(embeddingModel);

    // Generate embeddings for each input string
    const embeddings: number[][] = [];

    for (const text of input) {
      const result = await embed({
        model: model,
        value: text,
      });

      embeddings.push(result.embedding);
    }

    return embeddings;
  } catch (error) {
    logger.error("Error generating embeddings:", error);
    throw new Error("Failed to generate embeddings");
  }
}
