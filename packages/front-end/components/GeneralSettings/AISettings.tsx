import React, { useState, useEffect } from "react";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useFormContext, UseFormReturn } from "react-hook-form";
import {
  AI_PROMPT_DEFAULTS,
  AIPromptInterface,
  AI_PROVIDER_MODEL_MAP,
  AiModel,
  EmbeddingModel,
} from "shared/ai";
import { ensureAllUnionValues } from "shared/util";
import { useAuth } from "@/services/auth";
import Frame from "@/ui/Frame";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import SelectField from "@/components/Forms/SelectField";
import { isCloud, hasOpenAIKey, hasAnthropicKey } from "@/services/env";
import useApi from "@/hooks/useApi";
import Button from "@/ui/Button";
import { useAISettings } from "@/hooks/useOrgSettings";
import OptInModal from "@/components/License/OptInModal";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Callout from "@/ui/Callout";

const AI_MODEL_LABELS = ensureAllUnionValues<AiModel>()([
  { value: "gpt-4o-mini", label: "GTP 4o mini" },
  { value: "gpt-4o", label: "GTP 4o" },
  { value: "gpt-4-turbo", label: "GTP 4 turbo" },
  { value: "claude-haiku-4-5-20251001", label: "Claude 4.5 Haiku" },
  { value: "claude-sonnet-4-5-20250929", label: "Claude 4.5 Sonnet" },
  { value: "claude-opus-4-1-20250805", label: "Claude 4.1 Opus" },
  { value: "claude-opus-4-20250514", label: "Claude 4 Opus" },
  { value: "claude-sonnet-4-20250514", label: "Claude 4 Sonnet" },
  { value: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
  { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  { value: "claude-3-haiku-20240307", label: "Claude 3 Haiku" },
]);

const PROMPT_MODEL_LABELS = [
  { value: "", label: "-- Use Default AI Model --" },
  ...AI_MODEL_LABELS,
];

const EMBEDDING_MODEL_LABELS = ensureAllUnionValues<EmbeddingModel>()([
  { value: "text-embedding-3-small", label: "OpenAI text embedding 3 small" },
  { value: "text-embedding-3-large", label: "OpenAI text embedding 3 large" },
  { value: "text-embedding-ada-002", label: "OpenAI text embedding Ada 002" },
]);

// create a temp function which is passed a project and returns an array of prompts (promptId, promptName, promptDescription, promptValue)
function getPrompts(data: { prompts: AIPromptInterface[] }): Array<{
  promptType: string;
  promptName: string;
  promptDescription: string;
  promptValue: string;
  promptDefaultValue: string;
  promptHelpText: string;
  overrideModel: string | undefined;
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
  ];
}

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

  // Run the logic only once when `data` is loaded
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
      <Frame>
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
                      helpText="Choose the OpenAI embedding model to use. Default is text-embedding-ada-002."
                      value={
                        form.watch("embeddingModel") || "text-embedding-ada-002"
                      }
                      onChange={(v) => form.setValue("embeddingModel", v)}
                      options={EMBEDDING_MODEL_LABELS}
                    />
                  </Box>
                  {(() => {
                    const selectedModel =
                      form.watch("defaultAIModel") || "gpt-4o-mini";
                    const isAnthropicModel =
                      AI_PROVIDER_MODEL_MAP.anthropic.includes(selectedModel);
                    const isOpenAIModel =
                      AI_PROVIDER_MODEL_MAP.openai.includes(selectedModel);

                    // Check if any prompt overrides use Anthropic models
                    const promptUsesAnthropic = prompts.some((prompt) => {
                      const promptModel = promptForm.watch(
                        `${prompt.promptType}-model`,
                      );
                      return (
                        promptModel &&
                        AI_PROVIDER_MODEL_MAP.anthropic.includes(promptModel)
                      );
                    });

                    const showAnthropicKey =
                      isAnthropicModel || promptUsesAnthropic;

                    return (
                      <>
                        {showAnthropicKey && (
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
                              environment variable <code>OPENAI_API_KEY</code>.
                            </Box>
                          ) : (
                            <Box>
                              <Callout status="warning">
                                {isOpenAIModel
                                  ? "You must set your OpenAI API key to use GPT models."
                                  : "OpenAI API key is required for embeddings."}{" "}
                                Please define it in your environment variables
                                as <code>OPENAI_API_KEY</code>. See more in our{" "}
                                <a href="https://docs.growthbook.io/self-host/env">
                                  self-hosting docs
                                </a>
                                .
                              </Callout>
                            </Box>
                          )}
                        </Box>
                      </>
                    );
                  })()}
                </>
              )}
            </Flex>
          )}
        </Flex>
      </Frame>

      {/* Prompts Section */}
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
                              />
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
                      <Button
                        onClick={handleRegenerate}
                        disabled={loading || !hasOpenAIKey()}
                        variant="solid"
                      >
                        {loading ? "Regenerating..." : "Regenerate all"}
                      </Button>
                      {!hasOpenAIKey() && (
                        <Box mt="2">
                          <Callout status="warning">
                            OpenAI API key is required for embeddings. Please
                            set <code>OPENAI_API_KEY</code> in your environment
                            variables.
                          </Callout>
                        </Box>
                      )}
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
