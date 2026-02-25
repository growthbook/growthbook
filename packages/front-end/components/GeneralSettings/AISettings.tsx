import React, { useState, useEffect } from "react";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useFormContext, UseFormReturn } from "react-hook-form";
import {
  AI_PROMPT_DEFAULTS,
  AIPromptInterface,
  AIModel,
  EmbeddingModel,
  getProviderFromModel,
  getProviderFromEmbeddingModel,
} from "shared/ai";
import { ensureValuesExactlyMatchUnion } from "shared/util";
import { useAuth } from "@/services/auth";
import Frame from "@/ui/Frame";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import SelectField from "@/components/Forms/SelectField";
import {
  isCloud,
  hasOpenAIKey,
  hasAnthropicKey,
  hasXaiKey,
  hasMistralKey,
  hasGoogleAIKey,
} from "@/services/env";
import useApi from "@/hooks/useApi";
import Button from "@/ui/Button";
import { useAISettings } from "@/hooks/useOrgSettings";
import OptInModal from "@/components/License/OptInModal";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Callout from "@/ui/Callout";

const AI_MODEL_LABELS = ensureValuesExactlyMatchUnion<AIModel>()([
  // OpenAI GPT-5 series
  { value: "gpt-5.2", label: "OpenAI: GPT 5.2" },
  { value: "gpt-5.2-pro", label: "OpenAI: GPT 5.2 Pro" },
  { value: "gpt-5.1-codex", label: "OpenAI: GPT 5.1 Codex" },
  { value: "gpt-5.1-codex-max", label: "OpenAI: GPT 5.1 Codex Max" },
  { value: "gpt-5.1-codex-mini", label: "OpenAI: GPT 5.1 Codex Mini" },
  { value: "gpt-5", label: "OpenAI: GPT 5" },
  { value: "gpt-5-nano", label: "OpenAI: GPT 5 Nano" },
  { value: "gpt-5-mini", label: "OpenAI: GPT 5 Mini" },
  { value: "gpt-5-pro", label: "OpenAI: GPT 5 Pro" },
  { value: "gpt-5-codex", label: "OpenAI: GPT 5 Codex" },
  // OpenAI GPT-4 series
  { value: "gpt-4.1", label: "OpenAI: GPT 4.1" },
  { value: "gpt-4.1-mini", label: "OpenAI: GPT 4.1 Mini" },
  { value: "gpt-4.1-nano", label: "OpenAI: GPT 4.1 Nano" },
  { value: "gpt-4o", label: "OpenAI: GPT 4o" },
  { value: "gpt-4o-mini", label: "OpenAI: GPT 4o Mini" },
  // OpenAI O series (reasoning models)
  { value: "o4-mini", label: "OpenAI: O4 Mini" },
  { value: "o3", label: "OpenAI: O3" },
  { value: "o3-mini", label: "OpenAI: O3 Mini" },
  { value: "o1", label: "OpenAI: O1" },
  // Anthropic Claude
  {
    value: "claude-haiku-4-5-20251001",
    label: "Anthropic: Claude 4.5 Haiku (20251001)",
  },
  {
    value: "claude-sonnet-4-5-20250929",
    label: "Anthropic: Claude 4.5 Sonnet (20250929)",
  },
  {
    value: "claude-opus-4-1-20250805",
    label: "Anthropic: Claude 4.1 Opus (20250805)",
  },
  {
    value: "claude-opus-4-20250514",
    label: "Anthropic: Claude 4 Opus (20250514)",
  },
  {
    value: "claude-sonnet-4-20250514",
    label: "Anthropic: Claude 4 Sonnet (20250514)",
  },
  {
    value: "claude-3-7-sonnet-20250219",
    label: "Anthropic: Claude 3.7 Sonnet (20250219)",
  },
  {
    value: "claude-3-5-haiku-20241022",
    label: "Anthropic: Claude 3.5 Haiku (20241022)",
  },
  {
    value: "claude-3-haiku-20240307",
    label: "Anthropic: Claude 3 Haiku (20240307)",
  },
  // xAI Grok
  { value: "grok-code-fast-1", label: "xAI: Grok Code Fast 1" },
  {
    value: "grok-4-fast-non-reasoning",
    label: "xAI: Grok 4 Fast Non-Reasoning",
  },
  { value: "grok-4-fast-reasoning", label: "xAI: Grok 4 Fast Reasoning" },
  { value: "grok-4", label: "xAI: Grok 4" },
  { value: "grok-3", label: "xAI: Grok 3" },
  { value: "grok-3-mini", label: "xAI: Grok 3 Mini" },
  { value: "grok-3-fast", label: "xAI: Grok 3 Fast" },
  { value: "grok-3-mini-fast", label: "xAI: Grok 3 Mini Fast" },
  { value: "grok-2", label: "xAI: Grok 2" },
  // Mistral
  { value: "mistral-small", label: "Mistral: Mistral Small" },
  { value: "mistral-medium", label: "Mistral: Mistral Medium" },
  { value: "pixtral-12b", label: "Mistral: Pixtral 12B" },
  // Google Gemini
  { value: "gemini-3-pro-preview", label: "Google: Gemini 3 Pro Preview" },
  { value: "gemini-3-flash-preview", label: "Google: Gemini 3 Flash Preview" },
  { value: "gemini-2.5-flash", label: "Google: Gemini 2.5 Flash" },
  { value: "gemini-2.5-flash-lite", label: "Google: Gemini 2.5 Flash Lite" },
  { value: "gemini-2.5-pro", label: "Google: Gemini 2.5 Pro" },
  { value: "gemini-2.0-flash", label: "Google: Gemini 2.0 Flash" },
  { value: "gemini-2.0-flash-lite", label: "Google: Gemini 2.0 Flash Lite" },
  { value: "gemini-flash-latest", label: "Google: Gemini Flash Latest" },
  {
    value: "gemini-flash-lite-latest",
    label: "Google: Gemini Flash Lite Latest",
  },
  { value: "gemini-pro-latest", label: "Google: Gemini Pro Latest" },
]);

const PROMPT_MODEL_LABELS = [
  { value: "", label: "-- Use Default AI Model --" },
  ...AI_MODEL_LABELS,
];

const EMBEDDING_MODEL_LABELS = ensureValuesExactlyMatchUnion<EmbeddingModel>()([
  // OpenAI embeddings
  { value: "text-embedding-3-small", label: "OpenAI: text-embedding-3-small" },
  { value: "text-embedding-3-large", label: "OpenAI: text-embedding-3-large" },
  {
    value: "text-embedding-ada-002",
    label: "OpenAI: text-embedding-ada-002",
  },
  // Mistral embeddings
  { value: "mistral-embed", label: "Mistral: mistral-embed" },
  { value: "codestral-embed", label: "Mistral: codestral-embed" },
  // Google embeddings
  { value: "text-embedding-005", label: "Google: text-embedding-005" },
  {
    value: "text-multilingual-embedding-002",
    label: "Google: text-multilingual-embedding-002",
  },
  { value: "gemini-embedding-001", label: "Google: gemini-embedding-001" },
]);

const hasAPIforModel = (model: AIModel | string) => {
  let provider;
  try {
    provider = getProviderFromModel(model as AIModel);
  } catch {
    return false;
  }
  if (provider === "openai") {
    return hasOpenAIKey();
  }
  if (provider === "anthropic") {
    return hasAnthropicKey();
  }
  if (provider === "xai") {
    return hasXaiKey();
  }
  if (provider === "mistral") {
    return hasMistralKey();
  }
  if (provider === "google") {
    return hasGoogleAIKey();
  }
  return false;
};

function getPrompts(data: { prompts: AIPromptInterface[] }): Array<{
  promptType: string;
  promptName: string;
  promptDescription: string;
  promptValue: string;
  promptDefaultValue: string;
  promptHelpText: string;
  overrideModel: string | undefined;
  overrideModelHelpText?: string | undefined;
}> {
  return [
    {
      promptType: "experiment-analysis",
      promptName: "Experiment Analysis",
      promptDescription:
        "When an experiment is stopped, this prompt creates an analysis of the results.",
      promptValue:
        data.prompts.find((p) => p.type === "experiment-analysis")?.prompt ||
        AI_PROMPT_DEFAULTS["experiment-analysis"],
      promptDefaultValue: AI_PROMPT_DEFAULTS["experiment-analysis"],
      promptHelpText:
        "Make sure to explain the format of the results you would like to see.",
      overrideModel: data.prompts.find((p) => p.type === "experiment-analysis")
        ?.overrideModel,
    },
    {
      promptType: "experiment-hypothesis",
      promptName: "Hypothesis Format",
      promptDescription:
        "Specify a style for your hypothesis so that it is consistent across experiments.",
      promptValue:
        data.prompts.find((p) => p.type === "experiment-hypothesis")?.prompt ||
        AI_PROMPT_DEFAULTS["experiment-hypothesis"],
      promptDefaultValue: AI_PROMPT_DEFAULTS["experiment-hypothesis"],
      promptHelpText: "",
      overrideModel: data.prompts.find(
        (p) => p.type === "experiment-hypothesis",
      )?.overrideModel,
    },
    {
      promptType: "metric-description",
      promptName: "Metric Description",
      promptDescription:
        "When a metric is created, this prompt creates a description of the metric.",
      promptValue:
        data.prompts.find((p) => p.type === "metric-description")?.prompt ||
        AI_PROMPT_DEFAULTS["metric-description"],
      promptDefaultValue: AI_PROMPT_DEFAULTS["metric-description"],
      promptHelpText:
        "Make sure to explain the format of the results you would like to see.",
      overrideModel: data.prompts.find((p) => p.type === "metric-description")
        ?.overrideModel,
    },
    {
      promptType: "generate-sql-query",
      promptName: "Text to SQL Generation",
      promptDescription:
        "The prompt field below adds additional context when generating this SQL. Databases type, name and table structures are included automatically.",
      promptValue:
        data.prompts.find((p) => p.type === "generate-sql-query")?.prompt ||
        AI_PROMPT_DEFAULTS["generate-sql-query"],
      promptDefaultValue: AI_PROMPT_DEFAULTS["generate-sql-query"],
      overrideModelHelpText:
        "Some prompts are better than others at generating SQL.",
      promptHelpText:
        "Provide any additional guidance on how you would like SQL queries to be generated.",
      overrideModel: data.prompts.find((p) => p.type === "generate-sql-query")
        ?.overrideModel,
    },
  ];
}

/**
 * Small component to render a provider-specific API key warning
 * if the given model's provider does not have a configured API key.
 */
const ApiKeyWarning: React.FC<{ model?: string }> = ({ model }) => {
  if (!model) return null;
  if (hasAPIforModel(model)) return null;
  let provider;
  try {
    provider = getProviderFromModel(model as AIModel);
  } catch {
    return null;
  }
  return (
    <Box mt="2">
      <Callout status="warning">
        This AI model requires an API key for {provider} that is not defined.
      </Callout>
    </Box>
  );
};

export default function AISettings({
  promptForm,
}: {
  promptForm: UseFormReturn;
}) {
  const form = useFormContext();
  const { apiCall } = useAuth();
  const { aiAgreedTo } = useAISettings();
  const [optInModal, setOptInModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [embeddingMsg, setEmbeddingMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { hasCommercialFeature } = useUser();
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");

  // Subscribe to formState.isDirty by reading it during render.
  // This is required for react-hook-form to properly track dirty state
  // when this component modifies form values via register() or setValue().
  // See: https://react-hook-form.com/docs/useform/formstate (extracting formState)
  const { isDirty: _isDirty } = promptForm.formState;
  void _isDirty; // Ensure the variable is used to prevent tree-shaking

  const handleRegenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      await apiCall(
        "/experiments/regenerate-embeddings",
        {
          method: "POST",
        },
        (responseData) => {
          if (responseData.status === 429) {
            const retryAfter = parseInt(responseData.retryAfter);
            const hours = Math.floor(retryAfter / 3600);
            const minutes = Math.floor((retryAfter % 3600) / 60);
            setError(
              `You have reached the AI request limit. Try again in ${hours} hours and ${minutes} minutes.`,
            );
          } else if (responseData.message) {
            throw new Error(responseData.message);
          } else {
            setError("Error getting AI suggestion");
          }
        },
      );
      setEmbeddingMsg("Embeddings have been regenerated successfully.");
    } catch (error) {
      console.error("Error regenerating embeddings:", error);
    } finally {
      setLoading(false);
    }
  };

  const { data, isLoading } = useApi<{
    prompts: AIPromptInterface[];
  }>(`/ai/prompts`);

  useEffect(() => {
    if (data) {
      const prompts = getPrompts(data);
      prompts.forEach((prompt) => {
        promptForm.setValue(prompt.promptType, prompt.promptValue);
        promptForm.setValue(
          `${prompt.promptType}-model`,
          prompt.overrideModel || "",
        );
      });
    }
  }, [data, promptForm]);

  if (isLoading || !data) return null;

  const prompts = getPrompts(data);

  return (
    <>
      <Frame id="settings-ai">
        <Flex gap="4">
          <Box width="220px" flexShrink="0">
            <Heading size="4" as="h4">
              <PremiumTooltip commercialFeature="ai-suggestions">
                AI Settings
              </PremiumTooltip>
            </Heading>
          </Box>

          {!hasAISuggestions ? (
            <Box mb="6">
              <span className="text-muted">View AI Settings</span>
            </Box>
          ) : (
            <Flex align="start" direction="column" flexGrow="1" pt="6">
              <Flex align="start" gap="3" mb="6">
                <Box>
                  <Checkbox
                    value={form.watch("aiEnabled") && aiAgreedTo}
                    setValue={(v) => {
                      if (v && !aiAgreedTo) {
                        setOptInModal(true);
                        return;
                      }
                      form.setValue("aiEnabled", v);
                    }}
                    id="toggle-aiEnabled"
                    mt="1"
                  />
                </Box>
                <Flex direction="column">
                  <Text size="3" className="font-weight-semibold">
                    <label htmlFor="toggle-aiEnabled">Enable AI features</label>
                  </Text>
                  <Text>
                    Used to allow various AI features throughout GrowthBook.
                  </Text>
                </Flex>
              </Flex>
              {form.watch("aiEnabled") && !isCloud() && (
                <>
                  <Box mb="6" width="100%">
                    <Text
                      as="label"
                      htmlFor="defaultAIModel"
                      size="3"
                      className="font-weight-semibold"
                    >
                      Default AI model
                    </Text>
                    <SelectField
                      id="defaultAIModel"
                      helpText="Default is 4o-mini."
                      value={form.watch("defaultAIModel")}
                      onChange={(v) => form.setValue("defaultAIModel", v)}
                      options={AI_MODEL_LABELS}
                    />
                    {/* Use centralized warning component */}
                    <ApiKeyWarning
                      model={form.watch("defaultAIModel") || "gpt-4o-mini"}
                    />
                  </Box>
                  <Box mb="6" width="100%">
                    <Text
                      as="label"
                      htmlFor="embeddingModel"
                      size="3"
                      className="font-weight-semibold"
                    >
                      Embedding Model
                    </Text>
                    <SelectField
                      id="embeddingModel"
                      helpText="Choose the embedding model to use for semantic search. Supports OpenAI, Mistral, and Google. Default is text-embedding-ada-002."
                      value={
                        form.watch("embeddingModel") || "text-embedding-ada-002"
                      }
                      onChange={(v) => form.setValue("embeddingModel", v)}
                      options={EMBEDDING_MODEL_LABELS}
                    />
                  </Box>
                  {(() => {
                    const defaultModel = form.watch("defaultAIModel");
                    const usedProviders = new Set<string>();

                    // Add default model provider if set
                    if (defaultModel) {
                      try {
                        const defaultProvider =
                          getProviderFromModel(defaultModel);
                        usedProviders.add(defaultProvider);
                      } catch {
                        // Ignore invalid models
                      }
                    }

                    // Check which providers are used by prompts
                    prompts.forEach((prompt) => {
                      const promptModel = promptForm.watch(
                        `${prompt.promptType}-model`,
                      );
                      if (promptModel) {
                        try {
                          usedProviders.add(getProviderFromModel(promptModel));
                        } catch {
                          // Ignore invalid models
                        }
                      }
                    });

                    // Add embedding model provider if set
                    const embeddingModel = form.watch("embeddingModel");
                    if (embeddingModel) {
                      try {
                        const embeddingProvider =
                          getProviderFromEmbeddingModel(embeddingModel);
                        usedProviders.add(embeddingProvider);
                      } catch {
                        // Ignore invalid embedding models
                      }
                    }

                    return (
                      <>
                        {usedProviders.has("anthropic") && (
                          <Box mb="6" width="100%">
                            <Text
                              as="label"
                              size="3"
                              className="font-weight-semibold"
                            >
                              Anthropic API Key
                            </Text>
                            {hasAnthropicKey() ? (
                              <Box>
                                Your Anthropic API key is correctly set in your
                                environment variable{" "}
                                <code>ANTHROPIC_API_KEY</code>.
                              </Box>
                            ) : (
                              <Box>
                                <Callout status="warning">
                                  You must set your Anthropic API key to use
                                  Claude models. Please define it in your
                                  environment variables as{" "}
                                  <code>ANTHROPIC_API_KEY</code>. See more in
                                  our{" "}
                                  <a href="https://docs.growthbook.io/self-host/env">
                                    self-hosting docs
                                  </a>
                                  .
                                </Callout>
                              </Box>
                            )}
                          </Box>
                        )}
                        {usedProviders.has("xai") && (
                          <Box mb="6" width="100%">
                            <Text
                              as="label"
                              size="3"
                              className="font-weight-semibold"
                            >
                              xAI API Key
                            </Text>
                            {hasXaiKey() ? (
                              <Box>
                                Your xAI API key is correctly set in your
                                environment variable <code>XAI_API_KEY</code>.
                              </Box>
                            ) : (
                              <Box>
                                <Callout status="warning">
                                  You must set your xAI API key to use Grok
                                  models. Please define it in your environment
                                  variables as <code>XAI_API_KEY</code>. See
                                  more in our{" "}
                                  <a href="https://docs.growthbook.io/self-host/env">
                                    self-hosting docs
                                  </a>
                                  .
                                </Callout>
                              </Box>
                            )}
                          </Box>
                        )}
                        {usedProviders.has("mistral") && (
                          <Box mb="6" width="100%">
                            <Text
                              as="label"
                              size="3"
                              className="font-weight-semibold"
                            >
                              Mistral API Key
                            </Text>
                            {hasMistralKey() ? (
                              <Box>
                                Your Mistral API key is correctly set in your
                                environment variable{" "}
                                <code>MISTRAL_API_KEY</code>.
                              </Box>
                            ) : (
                              <Box>
                                <Callout status="warning">
                                  You must set your Mistral API key to use
                                  Mistral models. Please define it in your
                                  environment variables as{" "}
                                  <code>MISTRAL_API_KEY</code>. See more in our{" "}
                                  <a href="https://docs.growthbook.io/self-host/env">
                                    self-hosting docs
                                  </a>
                                  .
                                </Callout>
                              </Box>
                            )}
                          </Box>
                        )}
                        {usedProviders.has("google") && (
                          <Box mb="6" width="100%">
                            <Text
                              as="label"
                              size="3"
                              className="font-weight-semibold"
                            >
                              Google API Key
                            </Text>
                            {hasGoogleAIKey() ? (
                              <Box>
                                Your Google API key is correctly set in your
                                environment variable{" "}
                                <code>GOOGLE_AI_API_KEY</code>.
                              </Box>
                            ) : (
                              <Box>
                                <Callout status="warning">
                                  You must set your Google API key to use Gemini
                                  models. Please define it in your environment
                                  variables as <code>GOOGLE_AI_API_KEY</code>.
                                  See more in our{" "}
                                  <a href="https://docs.growthbook.io/self-host/env">
                                    self-hosting docs
                                  </a>
                                  .
                                </Callout>
                              </Box>
                            )}
                          </Box>
                        )}
                        {usedProviders.has("openai") && (
                          <Box mb="6" width="100%">
                            <Text
                              as="label"
                              size="3"
                              className="font-weight-semibold"
                            >
                              OpenAI API Key
                            </Text>
                            {hasOpenAIKey() ? (
                              <Box>
                                Your OpenAI API key is correctly set in your
                                environment variable <code>OPENAI_API_KEY</code>
                                .
                              </Box>
                            ) : (
                              <Box>
                                <Callout status="warning">
                                  You must set your OpenAI API key to use OpenAI
                                  models. Please define it in your environment
                                  variables as <code>OPENAI_API_KEY</code>. See
                                  more in our{" "}
                                  <a href="https://docs.growthbook.io/self-host/env">
                                    self-hosting docs
                                  </a>
                                  .
                                </Callout>
                              </Box>
                            )}
                          </Box>
                        )}
                      </>
                    );
                  })()}
                </>
              )}
            </Flex>
          )}
        </Flex>
      </Frame>

      {hasAISuggestions && form.watch("aiEnabled") && (
        <>
          <Frame>
            <Flex gap="4">
              <Box width="220px" flexShrink="0">
                <Heading size="4" as="h4">
                  Prompts
                </Heading>
              </Box>

              <Flex align="start" direction="column" flexGrow="1" pt="6">
                <>
                  <Box mb="6" width="100%">
                    <>
                      {prompts.map((prompt, index) => (
                        <Box key={index} mb="6" width="100%">
                          <Box>
                            <Text
                              size="3"
                              className="font-weight-semibold"
                              mb="1"
                            >
                              {prompt.promptName}
                            </Text>
                          </Box>
                          <Box mb="2">
                            <Text size="2" mb="2">
                              {prompt.promptDescription}
                            </Text>
                          </Box>
                          {!isCloud() && (
                            <Box mb="3">
                              <Text
                                as="label"
                                htmlFor={`${prompt.promptType}-model`}
                                size="2"
                                className="font-weight-semibold"
                              >
                                Model
                              </Text>
                              <SelectField
                                id={`${prompt.promptType}-model`}
                                value={
                                  promptForm.watch(
                                    `${prompt.promptType}-model`,
                                  ) || ""
                                }
                                onChange={(v) =>
                                  promptForm.setValue(
                                    `${prompt.promptType}-model`,
                                    v,
                                  )
                                }
                                options={PROMPT_MODEL_LABELS}
                                helpText={prompt?.overrideModelHelpText || ""}
                              />
                              {(() => {
                                const modelToCheck =
                                  promptForm.watch(
                                    `${prompt.promptType}-model`,
                                  ) || "";
                                if (!modelToCheck) {
                                  return null;
                                }
                                return <ApiKeyWarning model={modelToCheck} />;
                              })()}
                            </Box>
                          )}
                          <Box mb="3">
                            {!isCloud() && (
                              <Text
                                as="label"
                                htmlFor={`prompt-${prompt.promptType}`}
                                size="2"
                                className="font-weight-semibold"
                              >
                                Prompt
                              </Text>
                            )}
                            <Field
                              textarea={true}
                              id={`prompt-${prompt.promptType}`}
                              placeholder=""
                              helpText={prompt.promptHelpText}
                              {...promptForm.register(prompt.promptType)}
                            />
                          </Box>
                          {prompt.promptDefaultValue !==
                            promptForm.watch(prompt.promptType) && (
                            <Box style={{ position: "relative" }}>
                              <Box
                                style={{
                                  position: "absolute",
                                  right: "0",
                                  top: prompt.promptHelpText ? "-14px" : "-1px",
                                }}
                              >
                                <a
                                  href="#"
                                  title="Reset to the default AI prompt"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    promptForm.setValue(
                                      prompt.promptType,
                                      prompt.promptDefaultValue,
                                      { shouldDirty: true },
                                    );
                                  }}
                                >
                                  reset
                                </a>
                              </Box>
                            </Box>
                          )}
                        </Box>
                      ))}
                    </>
                  </Box>
                </>
              </Flex>
            </Flex>
          </Frame>
          <Frame>
            <Flex gap="4">
              <Box width="220px" flexShrink="0">
                <Heading size="4" as="h4">
                  Embeddings
                </Heading>
              </Box>

              <Flex align="start" direction="column" flexGrow="1" pt="6">
                <>
                  <Box mb="6" width="100%">
                    <>
                      <p>
                        GrowthBook can use AI to analyze your experiments for
                        semantic meaning. This is used to help you find related
                        experiments, and to generate summaries of your
                        experiments.
                      </p>
                      <p>
                        These similarity scores are automatically updated, but
                        if the results seem off, you can regenerate them here.
                      </p>
                      {(() => {
                        const embeddingModel =
                          form.watch("embeddingModel") ||
                          "text-embedding-ada-002";
                        let embeddingProvider = "openai";
                        let hasKey = true;
                        try {
                          embeddingProvider =
                            getProviderFromEmbeddingModel(embeddingModel);
                          if (embeddingProvider === "openai") {
                            hasKey = hasOpenAIKey();
                          } else if (embeddingProvider === "mistral") {
                            hasKey = hasMistralKey();
                          } else if (embeddingProvider === "google") {
                            hasKey = hasGoogleAIKey();
                          }
                        } catch {
                          // Use defaults
                        }

                        const providerNames: Record<string, string> = {
                          openai: "OpenAI",
                          mistral: "Mistral",
                          google: "Google",
                          anthropic: "Anthropic",
                          xai: "xAI",
                        };

                        const providerEnvVars: Record<string, string> = {
                          openai: "OPENAI_API_KEY",
                          mistral: "MISTRAL_API_KEY",
                          google: "GOOGLE_AI_API_KEY",
                          anthropic: "ANTHROPIC_API_KEY",
                          xai: "XAI_API_KEY",
                        };

                        return (
                          <>
                            <Button
                              onClick={handleRegenerate}
                              disabled={loading || !hasKey}
                              variant="solid"
                            >
                              {loading ? "Regenerating..." : "Regenerate all"}
                            </Button>
                            {!hasKey && (
                              <Box mt="2">
                                <Callout status="warning">
                                  {providerNames[embeddingProvider]} API key is
                                  required for embeddings. Please set{" "}
                                  <code>
                                    {providerEnvVars[embeddingProvider]}
                                  </code>{" "}
                                  in your environment variables.
                                </Callout>
                              </Box>
                            )}
                          </>
                        );
                      })()}
                      {error && (
                        <Box className="col-auto pt-3">
                          <div className="alert alert-danger">{error}</div>
                        </Box>
                      )}
                    </>
                    <Box mt="3">{embeddingMsg}</Box>
                  </Box>
                </>
              </Flex>
            </Flex>
          </Frame>
        </>
      )}
      {optInModal && (
        <OptInModal agreement="ai" onClose={() => setOptInModal(false)} />
      )}
    </>
  );
}
