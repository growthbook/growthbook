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
import {
  createOpenAI,
  type OpenAIResponsesProviderOptions,
} from "@ai-sdk/openai";
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
  AIProvider,
  getProviderFromModel,
  getProviderFromEmbeddingModel,
  getProviderForAIModel,
  supportsTemperature,
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
import {
  getAISettingsForOrg,
  getAllowedAIModel,
} from "back-end/src/services/organizations";
import {
  AIKeySource,
  missingAIKeyMessage,
} from "back-end/src/services/aiCredentials";
import { logCloudAIUsage } from "back-end/src/services/licenseServerManagedClickhouse";
import { AIUsageOutcome, trackAIUsage } from "back-end/src/services/growthbook";
import { IS_CLOUD } from "back-end/src/util/secrets";

const usesOwnAIKey = (
  keySource: Record<AIProvider, AIKeySource>,
  model: AIModel,
): boolean => {
  if (!IS_CLOUD) return true;
  const provider = getProviderForAIModel("text", model);
  return provider !== null && keySource[provider] === "organization";
};

export const resolveTextAIModel = (
  overrideModel: AIModel | undefined,
  defaultAIModel: AIModel,
  keySource: Record<AIProvider, AIKeySource>,
): AIModel =>
  getAllowedAIModel("text", overrideModel, keySource) || defaultAIModel;

export const getAIProviderClass = async (
  context: ReqContext | ApiReqContext,
  model: AIModel,
): Promise<
  | ReturnType<typeof createAnthropic>
  | ReturnType<typeof createOpenAI>
  | ReturnType<typeof createXai>
  | ReturnType<typeof createMistral>
  | ReturnType<typeof createGoogleGenerativeAI>
> => {
  const {
    aiEnabled,
    openAIAPIKey,
    anthropicAPIKey,
    xaiAPIKey,
    mistralAPIKey,
    googleAPIKey,
  } = await getAISettingsForOrg(context, true);

  if (!aiEnabled) {
    throw new Error(
      "AI is not enabled for this organization. Visit Settings → AI Settings to enable it.",
    );
  }

  const selectedProvider = getProviderFromModel(model);

  if (selectedProvider === "anthropic") {
    if (!anthropicAPIKey) {
      throw new Error(missingAIKeyMessage("anthropic"));
    }
    return createAnthropic({
      apiKey: anthropicAPIKey,
    });
  } else if (selectedProvider === "xai") {
    if (!xaiAPIKey) {
      throw new Error(missingAIKeyMessage("xai"));
    }
    return createXai({
      apiKey: xaiAPIKey,
    });
  } else if (selectedProvider === "mistral") {
    if (!mistralAPIKey) {
      throw new Error(missingAIKeyMessage("mistral"));
    }
    return createMistral({
      apiKey: mistralAPIKey,
    });
  } else if (selectedProvider === "google") {
    if (!googleAPIKey) {
      throw new Error(missingAIKeyMessage("google"));
    }
    return createGoogleGenerativeAI({
      apiKey: googleAPIKey,
    });
  } else {
    if (!openAIAPIKey) {
      throw new Error(missingAIKeyMessage("openai"));
    }
    return createOpenAI({
      apiKey: openAIAPIKey,
    });
  }
};

function getOpenAIProviderOptions(model: AIModel) {
  if (getProviderFromModel(model) !== "openai") return {};

  return {
    providerOptions: {
      openai: {
        store: false,
        include: ["reasoning.encrypted_content"],
      } satisfies OpenAIResponsesProviderOptions,
    },
  };
}

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

export const secondsUntilAICanBeUsedAgainForProvider = async (
  context: ReqContext | ApiReqContext,
  provider: AIProvider | undefined,
): Promise<number> => {
  if (!IS_CLOUD) return 0;
  const { keySource } = await getAISettingsForOrg(context);
  if (provider && keySource[provider] === "organization") return 0;
  return secondsUntilAICanBeUsedAgain(context.org);
};

export const secondsUntilAICanBeUsedAgainForModel = async (
  context: ReqContext | ApiReqContext,
  overrideModel?: AIModel,
): Promise<number> => {
  if (!IS_CLOUD) return 0;
  const { defaultAIModel, keySource } = await getAISettingsForOrg(context);
  const model = resolveTextAIModel(overrideModel, defaultAIModel, keySource);
  const provider = getProviderForAIModel("text", model) ?? undefined;
  return secondsUntilAICanBeUsedAgainForProvider(context, provider);
};

export const secondsUntilAICanBeUsedAgainForPrompt = async (
  context: ReqContext | ApiReqContext,
  type: AIPromptType,
): Promise<number> => {
  if (!IS_CLOUD) return 0;
  const { overrideModel } = await context.models.aiPrompts.getAIPrompt(type);
  return secondsUntilAICanBeUsedAgainForModel(context, overrideModel);
};

export const secondsUntilAICanBeUsedAgainForEmbeddings = async (
  context: ReqContext | ApiReqContext,
): Promise<number> => {
  if (!IS_CLOUD) return 0;
  const { embeddingModel } = await getAISettingsForOrg(context);
  const provider =
    getProviderForAIModel("embedding", embeddingModel) ?? undefined;
  return secondsUntilAICanBeUsedAgainForProvider(context, provider);
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
  const { defaultAIModel, keySource } = await getAISettingsForOrg(
    context,
    true,
  );

  const model = resolveTextAIModel(overrideModel, defaultAIModel, keySource);
  const ownKey = usesOwnAIKey(keySource, model);

  const aiProvider = await getAIProviderClass(context, model);

  if (aiProvider == null) {
    throw new Error("AI provider not enabled or key not set");
  }

  const messages = constructMessages(prompt, instructions);

  // Some models reject `temperature` outright (400) and others silently drop
  // it; omit it entirely for both.
  const effectiveTemperature = supportsTemperature(model)
    ? temperature
    : undefined;

  const generateOptions = {
    model: aiProvider(model) as Parameters<typeof generateText>[0]["model"],
    messages,
    ...getOpenAIProviderOptions(model),
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
    if (!ownKey) {
      if (!numTokensUsed) {
        numTokensUsed = numTokensFromMessages(messages, model);
      }
      await updateTokenUsage({ numTokensUsed, organization: context.org });
    }

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

  trackAIUsage({
    organizationId: context.org.id,
    userId: context.userId,
    type,
    model,
    provider: getProviderFromModel(model),
    numPromptTokensUsed: inputTokensUsed,
    numCompletionTokensUsed: outputTokensUsed,
    usedDefaultPrompt: isDefaultPrompt,
    usedOwnKey: ownKey,
  });

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
  const { defaultAIModel, keySource } = await getAISettingsForOrg(
    context,
    true,
  );
  const model = resolveTextAIModel(overrideModel, defaultAIModel, keySource);
  const ownKey = usesOwnAIKey(keySource, model);
  const aiProvider = await getAIProviderClass(context, model);

  if (aiProvider == null) {
    throw new Error("AI provider not enabled or key not set");
  }

  // Some models reject `temperature` outright (400) and others silently drop
  // it; omit it entirely for both.
  const effectiveTemperature = supportsTemperature(model)
    ? temperature
    : undefined;

  const recordUsage = async ({
    inputTokens,
    outputTokens,
    totalTokens,
    outcome,
  }: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    outcome: AIUsageOutcome;
  }) => {
    trackAIUsage({
      organizationId: context.org.id,
      userId: context.userId,
      type,
      model,
      provider: getProviderFromModel(model),
      numPromptTokensUsed: inputTokens,
      numCompletionTokensUsed: outputTokens,
      usedDefaultPrompt: isDefaultPrompt,
      usedOwnKey: ownKey,
      outcome,
    });

    if (!IS_CLOUD) return;

    const numTokensUsed = totalTokens ?? 0;
    if (numTokensUsed && !ownKey) {
      try {
        await updateTokenUsage({ numTokensUsed, organization: context.org });
      } catch (e) {
        // Accounting failures must not turn a completed AI response into a 500.
        logger.error(e, "streamingChatCompletion: could not meter token usage");
      }
    }

    logCloudAIUsage({
      organization: context.org.id,
      type,
      model,
      numPromptTokensUsed: inputTokens,
      numCompletionTokensUsed: outputTokens,
      temperature: effectiveTemperature,
      usedDefaultPrompt: isDefaultPrompt,
    });
  };

  type TerminalUsage = {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    outcome: AIUsageOutcome;
  };
  let terminalUsage: TerminalUsage | undefined;
  let streamErrored = false;

  const result = streamText({
    model: aiProvider(model) as Parameters<typeof streamText>[0]["model"],
    system,
    messages,
    ...getOpenAIProviderOptions(model),
    ...(effectiveTemperature != null
      ? { temperature: effectiveTemperature }
      : {}),
    ...(tools
      ? {
          tools,
          stopWhen: stepCountIs(maxSteps),
          // Same force-a-final-answer guard parsePrompt uses: a model that
          // keeps calling tools until it exhausts maxSteps otherwise ends ON
          // a tool call, and the stream closes having emitted no text at all.
          prepareStep: ({ stepNumber }: { stepNumber: number }) =>
            stepNumber >= maxSteps - 1 ? { toolChoice: "none" as const } : {},
        }
      : {}),
    ...(abortSignal ? { abortSignal } : {}),
    onFinish: ({ totalUsage }) => {
      // onFinish's `usage` is only the last step; totalUsage covers the run.
      if (terminalUsage?.outcome !== "aborted") {
        terminalUsage = {
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
          totalTokens: totalUsage.totalTokens,
          outcome: streamErrored ? "error" : "success",
        };
      }
    },
    onAbort: ({ steps }) => {
      const usage = steps.reduce(
        (acc, step) => ({
          inputTokens: acc.inputTokens + (step.usage?.inputTokens ?? 0),
          outputTokens: acc.outputTokens + (step.usage?.outputTokens ?? 0),
          totalTokens: acc.totalTokens + (step.usage?.totalTokens ?? 0),
        }),
        { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      );
      terminalUsage = { ...usage, outcome: "aborted" };
    },
    onError: ({ error }) => {
      logger.error(error, "streamingChatCompletion: stream error");
      streamErrored = true;
    },
  });

  let accountingPromise: Promise<void> | undefined;
  const completeAccounting = (): Promise<void> => {
    if (!accountingPromise) {
      accountingPromise = (async () => {
        try {
          await result.response;
        } catch {
          // The terminal outcome is recorded below.
        }
        await recordUsage(
          terminalUsage ?? {
            outcome: streamErrored ? "error" : "aborted",
          },
        );
      })();
    }
    return accountingPromise;
  };

  return { result, completeAccounting };
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
  const { defaultAIModel, keySource } = await getAISettingsForOrg(
    context,
    true,
  );
  const model = resolveTextAIModel(overrideModel, defaultAIModel, keySource);
  const ownKey = usesOwnAIKey(keySource, model);

  const aiProvider = await getAIProviderClass(context, model);

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

  // Some models reject `temperature` outright (400) and others silently drop
  // it; omit it entirely for both.
  const effectiveTemperature = supportsTemperature(model)
    ? temperature
    : undefined;

  // Per-attempt step telemetry. Without it a no-output failure is
  // indistinguishable from a model that answered in prose on step one —
  // only the first is helped by a bigger maxSteps.
  let stepsUsed = 0;
  let toolsCalled: string[] = [];

  const generateOnce = async () => {
    stepsUsed = 0;
    toolsCalled = [];
    const result = await generateText({
      model: aiProvider(model) as Parameters<typeof generateText>[0]["model"],
      messages: messages,
      ...getOpenAIProviderOptions(model),
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
      onStepFinish: (step) => {
        stepsUsed++;
        for (const call of step.toolCalls ?? [])
          toolsCalled.push(call.toolName);
        onStepFinish?.(step);
      },
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
      orgId: context.org.id,
      userId: context.userId,
      stepsUsed,
      maxSteps,
      toolsCalled,
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
  const recordFailedAttempts = async () => {
    if (IS_CLOUD && !ownKey && retriedTokens > 0) {
      await updateTokenUsage({
        numTokensUsed: retriedTokens,
        organization: context.org,
      });
    }
    trackAIUsage({
      organizationId: context.org.id,
      userId: context.userId,
      type,
      model,
      provider: getProviderFromModel(model),
      numRetriedTokensUsed: retriedTokens,
      usedDefaultPrompt: isDefaultPrompt,
      usedOwnKey: ownKey,
      outcome: "error",
    });
  };

  let response: Awaited<ReturnType<typeof generateOnce>>;
  try {
    response = await generateOnce();
  } catch (err) {
    if (!isGenerationFailure(err)) throw err;
    retriedTokens += failureTokens(err);
    // Don't stack retries when the caller is already a retry path.
    if (!retryOnNoObject) {
      await recordFailedAttempts();
      throw err;
    }
    logger.warn(
      { type, model, ...noOutputDiag(err) },
      "parsePrompt: model returned no usable output; retrying once",
    );
    try {
      response = await generateOnce();
    } catch (retryErr) {
      if (!isGenerationFailure(retryErr)) {
        await recordFailedAttempts();
        throw retryErr;
      }
      retriedTokens += failureTokens(retryErr);
      logger.warn(
        { type, model, ...noOutputDiag(retryErr) },
        "parsePrompt: model returned no usable output after retry; giving up",
      );
      await recordFailedAttempts();
      // If either attempt stopped on the output-token ceiling, the JSON was
      // cut off mid-stream — a generic "try again" won't help an inherently
      // too-large response, so point the user at narrowing the request.
      const truncated =
        (NoObjectGeneratedError.isInstance(err) &&
          err.finishReason === "length") ||
        (NoObjectGeneratedError.isInstance(retryErr) &&
          retryErr.finishReason === "length");
      // No output at all (burned its steps on tools, or answered in prose) —
      // rephrasing won't help, narrowing the request will.
      const ranOutOfSteps = NoOutputGeneratedError.isInstance(retryErr);
      throw new Error(
        truncated
          ? "Your request produced a response too large to return in one piece. Try a more focused request — for example, edit one section or a few elements at a time, then layer on more."
          : ranOutOfSteps
            ? "The AI didn't finish this request — it spent its time gathering page details instead of returning a change. Try pointing it at a specific element, or splitting this into smaller changes."
            : "The AI couldn't format a valid response for this request. Please try again, or rephrase/simplify the request.",
      );
    }
  }

  trackAIUsage({
    organizationId: context.org.id,
    userId: context.userId,
    type,
    model,
    provider: getProviderFromModel(model),
    numPromptTokensUsed: response.usage?.inputTokens,
    numCompletionTokensUsed: response.usage?.outputTokens,
    numRetriedTokensUsed: retriedTokens,
    usedDefaultPrompt: isDefaultPrompt,
    usedOwnKey: ownKey,
  });

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

    // Only meter usage against the daily cap when GrowthBook is paying.
    if (!ownKey) {
      const numTokensUsed =
        (response.usage?.totalTokens ??
          numTokensFromMessages(messages, model)) + retriedTokens;
      await updateTokenUsage({ numTokensUsed, organization: context.org });
    }
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
    keySource,
  } = await getAISettingsForOrg(context, true);

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
    let numTokensUsed = 0;

    for (const text of input) {
      const result = await embed({
        model: model,
        value: text,
      });

      numTokensUsed += result.usage?.tokens ?? 0;
      embeddings.push(result.embedding);
    }

    // One event per batch, counted as prompt tokens. Still not metered against
    // the daily cap — they never were, and starting now would silently shrink
    // every managed-key org's text budget.
    trackAIUsage({
      organizationId: context.org.id,
      userId: context.userId,
      type: "generate-embeddings",
      model: embeddingModel,
      provider,
      numPromptTokensUsed: numTokensUsed,
      // No prompt template exists for embeddings, so nothing was customized.
      usedDefaultPrompt: true,
      usedOwnKey: keySource[provider] === "organization",
    });

    return embeddings;
  } catch (error) {
    logger.error("Error generating embeddings:", error);
    throw new Error("Failed to generate embeddings");
  }
}
