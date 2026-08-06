import React, { useState, useEffect } from "react";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useFormContext, UseFormReturn } from "react-hook-form";
import {
  AI_PROMPT_DEFAULTS,
  AI_PROVIDER_META,
  AIPromptInterface,
  AIModel,
  AIProvider,
  EmbeddingModel,
  formatAIRateLimitRetryMessage,
  getProviderFromModel,
  getProviderFromEmbeddingModel,
} from "shared/ai";
import {
  getAvailableAIModelOptions,
  getAvailableEmbeddingModelOptions,
  getAvailableImageModelOptions,
  getAvailablePromptModelOptions,
} from "@/services/aiModelSelectOptions";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Frame from "@/ui/Frame";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import SelectField from "@/components/Forms/SelectField";
import useApi from "@/hooks/useApi";
import Button from "@/ui/Button";
import { useAISettings } from "@/hooks/useOrgSettings";
import OptInModal from "@/components/License/OptInModal";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Callout from "@/ui/Callout";
import AIProviderKeys, { useAIProviderKeys } from "./AIProviderKeys";

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
    {
      promptType: "product-analytics-chat",
      promptName: "Product Analytics AI Analyst",
      promptDescription:
        "Used by the product analytics explorer AI assistant. GrowthBook still provides Data Source context, metrics and fact tables, exploration schema, and tool behavior automatically; the field below adds organization-specific guidance (tone, naming, policies, how to explain charts, etc.).",
      promptValue:
        data.prompts.find((p) => p.type === "product-analytics-chat")?.prompt ||
        AI_PROMPT_DEFAULTS["product-analytics-chat"],
      promptDefaultValue: AI_PROMPT_DEFAULTS["product-analytics-chat"],
      promptHelpText:
        "Leave blank to use only the built-in assistant instructions. When set, this text is appended to the system prompt.",
      overrideModelHelpText:
        "Tool-heavy assistants often work better with a capable model.",
      overrideModel: data.prompts.find(
        (p) => p.type === "product-analytics-chat",
      )?.overrideModel,
    },
  ];
}

// Warns when the selected model's provider has no key, stored or inherited.
// `hasKey` comes from useAIProviderKeys so org-stored keys count.
const ApiKeyWarning: React.FC<{
  model?: string;
  hasKey: (model: AIModel | string) => boolean;
}> = ({ model, hasKey }) => {
  if (!model) return null;
  if (hasKey(model)) return null;
  let provider: AIProvider;
  try {
    provider = getProviderFromModel(model as AIModel);
  } catch {
    return null;
  }
  return (
    <Box mt="2">
      <Callout status="warning">
        This model needs a {AI_PROVIDER_META[provider].label} API key. Add one
        under AI providers above.
      </Callout>
    </Box>
  );
};

// ApiKeyWarning for embedding models, which live in their own registry.
const EmbeddingKeyWarning: React.FC<{
  embeddingModel: string;
  hasKey: (provider: AIProvider) => boolean;
}> = ({ embeddingModel, hasKey }) => {
  let provider: AIProvider;
  try {
    provider = getProviderFromEmbeddingModel(embeddingModel as EmbeddingModel);
  } catch {
    return null;
  }
  if (hasKey(provider)) return null;
  return (
    <Box mt="2">
      <Callout status="warning">
        This embedding model needs a {AI_PROVIDER_META[provider].label} API key.
        Add one under AI providers above.
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
  const aiProviderAccess = useAIProviderKeys();
  const {
    hasKeyForModel,
    hasKeyForProvider,
    canChooseModels,
    selectableProviders: availableProviders,
  } = aiProviderAccess;

  // Every field here writes org settings, which the back end gates on
  // canManageOrgSettings. Without this the controls look editable to a non-admin
  // and only fail on save.
  const permissionsUtil = usePermissionsUtil();
  const canEdit = permissionsUtil.canManageOrgSettings();

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
            setError(formatAIRateLimitRetryMessage(responseData.retryAfter));
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

  const { data, error: promptsError } = useApi<{
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

  const prompts = data ? getPrompts(data) : [];

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
            <Flex align="start" direction="column" flexGrow="1">
              <Box mb="6">
                <span className="text-muted">View AI Settings</span>
              </Box>
              {/* A downgrade shouldn't strand a stored key. The rows render as
                  Inactive with Remove as the only action. */}
              <AIProviderKeys access={aiProviderAccess} />
            </Flex>
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
                    disabled={!canEdit}
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
              {!canEdit && (
                <Box mb="6" width="100%">
                  <Callout status="info">
                    You need permission to manage organization settings to
                    change AI settings.
                  </Callout>
                </Box>
              )}
              {/* Rendered even when AI is disabled or the plan was downgraded,
                  so stored credentials and load errors stay reachable. */}
              <AIProviderKeys
                access={aiProviderAccess}
                showPermissionCallout={false}
              />

              {form.watch("aiEnabled") && canChooseModels && (
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
                      size="medium"
                      id="defaultAIModel"
                      disabled={!canEdit}
                      helpText="Used by every AI feature that doesn't override it."
                      value={form.watch("defaultAIModel")}
                      onChange={(v) => form.setValue("defaultAIModel", v)}
                      // Keep the registry's newest-first model order.
                      sort={false}
                      options={getAvailableAIModelOptions(
                        availableProviders,
                        form.watch("defaultAIModel"),
                      )}
                    />
                    <ApiKeyWarning
                      model={form.watch("defaultAIModel") || "gpt-4o-mini"}
                      hasKey={hasKeyForModel}
                    />
                  </Box>
                  <Box mb="6" width="100%">
                    <Text
                      as="label"
                      htmlFor="embeddingModel"
                      size="3"
                      className="font-weight-semibold"
                    >
                      Embedding model
                    </Text>
                    <SelectField
                      size="medium"
                      id="embeddingModel"
                      disabled={!canEdit}
                      helpText="Used for semantic search across experiments. Supports OpenAI, Mistral, and Google. Default is text-embedding-ada-002."
                      value={
                        form.watch("embeddingModel") || "text-embedding-ada-002"
                      }
                      onChange={(v) => form.setValue("embeddingModel", v)}
                      options={getAvailableEmbeddingModelOptions(
                        availableProviders,
                        form.watch("embeddingModel") ||
                          "text-embedding-ada-002",
                      )}
                    />
                    <EmbeddingKeyWarning
                      embeddingModel={
                        form.watch("embeddingModel") || "text-embedding-ada-002"
                      }
                      hasKey={hasKeyForProvider}
                    />
                  </Box>
                </>
              )}
            </Flex>
          )}
        </Flex>
      </Frame>

      {hasAISuggestions && form.watch("aiEnabled") && promptsError && (
        <Frame>
          <Callout status="error">
            Could not load AI prompts. {promptsError.message}
          </Callout>
        </Frame>
      )}
      {hasAISuggestions && form.watch("aiEnabled") && data && (
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
                          {canChooseModels && (
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
                                size="medium"
                                id={`${prompt.promptType}-model`}
                                disabled={!canEdit}
                                value={
                                  promptForm.watch(
                                    `${prompt.promptType}-model`,
                                  ) || ""
                                }
                                onChange={(v) =>
                                  promptForm.setValue(
                                    `${prompt.promptType}-model`,
                                    v,
                                    { shouldDirty: true },
                                  )
                                }
                                // Keep the registry's newest-first model order.
                                sort={false}
                                options={getAvailablePromptModelOptions(
                                  availableProviders,
                                  promptForm.watch(
                                    `${prompt.promptType}-model`,
                                  ) || "",
                                )}
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
                                return (
                                  <ApiKeyWarning
                                    model={modelToCheck}
                                    hasKey={hasKeyForModel}
                                  />
                                );
                              })()}
                            </Box>
                          )}
                          <Box mb="3">
                            {canChooseModels && (
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
                              size="md"
                              textarea={true}
                              id={`prompt-${prompt.promptType}`}
                              placeholder=""
                              disabled={!canEdit}
                              helpText={prompt.promptHelpText}
                              {...promptForm.register(prompt.promptType)}
                            />
                          </Box>
                          {canEdit &&
                            prompt.promptDefaultValue !==
                              promptForm.watch(prompt.promptType) && (
                              <Box style={{ position: "relative" }}>
                                <Box
                                  style={{
                                    position: "absolute",
                                    right: "0",
                                    top: prompt.promptHelpText
                                      ? "-14px"
                                      : "-1px",
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
          {/* Visual Editor frame — sits between Prompts and Embeddings.
              Owns per-surface model overrides + the brand-guidelines
              context that gets prepended to every visual-editor AI
              call (text edits + image gen). All fields gated on
              !isCloud() in the inner UI; the frame itself renders so
              cloud users at least see the section exists. */}
          <Frame>
            <Flex gap="4">
              <Box width="220px" flexShrink="0">
                <Heading size="4" as="h4">
                  Visual Editor
                </Heading>
              </Box>

              <Flex align="start" direction="column" flexGrow="1" pt="6">
                <Box mb="6" width="100%">
                  <Text size="2" mb="3" as="div" className="text-muted">
                    Settings for the GrowthBook Visual Editor Chrome extension.
                    Per-surface model overrides + a free-text brand context
                    that&rsquo;s passed to every AI call.
                  </Text>

                  {/* Brand context / guidelines. Available on both
                      cloud and self-hosted — it's a pure-text setting
                      that doesn't depend on local API keys. Prepended
                      to text-edit AND image-gen prompts on the back
                      end (see postAIEdit / postAIImageGen). */}
                  <Box mb="4">
                    <Text
                      as="label"
                      htmlFor="visualEditorAIContext"
                      size="2"
                      className="font-weight-semibold"
                    >
                      Brand guidelines / additional context
                    </Text>
                    <Field
                      textarea={true}
                      id="visualEditorAIContext"
                      disabled={!canEdit}
                      placeholder={
                        'e.g. "We\'re a B2B SaaS company. Brand colors: #6E56CF and #1F2D5C. Sentence-case CTAs. Friendly but professional tone."'
                      }
                      helpText="Prepended to every Visual Editor AI prompt (text edits + image generation) so the AI follows your brand voice and visual identity."
                      {...form.register("visualEditorAIContext")}
                    />
                  </Box>

                  {canChooseModels && (
                    <>
                      <Box mb="4">
                        <Text
                          as="label"
                          htmlFor="visualEditorAIModel"
                          size="2"
                          className="font-weight-semibold"
                        >
                          Visual Editor text model
                        </Text>
                        <SelectField
                          size="medium"
                          id="visualEditorAIModel"
                          disabled={!canEdit}
                          helpText="Used for AI chat edits and AI suggestions in the extension. Leave blank to use the Default AI model."
                          value={form.watch("visualEditorAIModel") || ""}
                          onChange={(v) =>
                            form.setValue("visualEditorAIModel", v)
                          }
                          // Keep the registry's newest-first model order.
                          sort={false}
                          options={[
                            { value: "", label: "Use default AI model" },
                            ...getAvailableAIModelOptions(
                              availableProviders,
                              form.watch("visualEditorAIModel") || "",
                            ),
                          ]}
                        />
                        {form.watch("visualEditorAIModel") && (
                          <ApiKeyWarning
                            model={form.watch("visualEditorAIModel")}
                            hasKey={hasKeyForModel}
                          />
                        )}
                      </Box>
                      <Box>
                        <Text
                          as="label"
                          htmlFor="visualEditorImageModel"
                          size="2"
                          className="font-weight-semibold"
                        >
                          Visual Editor image model
                        </Text>
                        <SelectField
                          size="medium"
                          id="visualEditorImageModel"
                          disabled={!canEdit}
                          helpText="Models that support reference images can use an existing image as visual context (the Visual Editor's “use current image” flow). Text-only models generate from the prompt alone."
                          value={form.watch("visualEditorImageModel") || ""}
                          onChange={(v) =>
                            form.setValue("visualEditorImageModel", v)
                          }
                          sort={false}
                          options={getAvailableImageModelOptions(
                            availableProviders,
                            form.watch("visualEditorImageModel") || "",
                          )}
                        />
                      </Box>
                    </>
                  )}
                </Box>
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
                        // Assume a key until proven otherwise, so an unknown
                        // model doesn't disable the button.
                        let hasKey = true;
                        try {
                          hasKey = hasKeyForProvider(
                            getProviderFromEmbeddingModel(embeddingModel),
                          );
                        } catch {
                          // Unknown embedding model — leave the button enabled.
                        }

                        return (
                          <>
                            <Button
                              onClick={handleRegenerate}
                              disabled={loading || !hasKey || !canEdit}
                              variant="solid"
                            >
                              {loading ? "Regenerating..." : "Regenerate all"}
                            </Button>
                            <EmbeddingKeyWarning
                              embeddingModel={embeddingModel}
                              hasKey={hasKeyForProvider}
                            />
                          </>
                        );
                      })()}
                      {error && (
                        <Box className="col-auto pt-3">
                          <Callout status="error">{error}</Callout>
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
