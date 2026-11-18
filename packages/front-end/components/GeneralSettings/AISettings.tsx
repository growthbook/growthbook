import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { useFormContext, UseFormReturn } from "react-hook-form";
import {
  AI_PROMPT_DEFAULTS,
  AI_PROVIDER_META,
  AIModelSettingKey,
  CLOUD_MANAGED_AI_MODEL,
  AIPromptInterface,
  AIModel,
  AIPromptType,
  AIProvider,
  AUTOCOMPLETE_AI_MODEL,
  formatAIRateLimitRetryMessage,
  getProviderForAIModel,
  resolveDefaultSTTModel,
} from "shared/ai";
import Text from "@/ui/Text";
import {
  EMBEDDING_MODEL_OPTIONS,
  getAvailableAIModelOptions,
  getAvailableEmbeddingModelOptions,
  getAvailableImageModelOptions,
  getAvailablePromptModelOptions,
  getAvailableSTTModelOptions,
  getModelDisplayLabel,
  GROWTHBOOK_DEFAULT_MODEL_OPTION,
  USE_DEFAULT_MODEL_OPTION,
} from "@/services/aiModelSelectOptions";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
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
import Link from "@/ui/Link";
import { SettingsField, SettingsGroup, UnsavedMark } from "./SettingsGroup";
import AIProviderKeys, { useAIProviderKeys } from "./AIProviderKeys";
import AgentSkillsSettings from "./AgentSkillsSettings";
import type { PromptFormValues } from "./SettingsFormProvider";

const PROMPTS: {
  promptType: AIPromptType;
  promptName: string;
  promptDefaultValue: string;
  promptDescription: string;
  promptHelpText: string;
  overrideModelHelpText?: string;
}[] = [
  {
    promptType: "experiment-analysis",
    promptDefaultValue: AI_PROMPT_DEFAULTS["experiment-analysis"],
    promptName: "Experiment analysis",
    promptDescription:
      "Writes an analysis of results when an experiment stops. Describe the format you want.",
    promptHelpText:
      "Make sure to explain the format of the results you would like to see.",
  },
  {
    promptType: "find-learnings-context",
    promptDefaultValue: AI_PROMPT_DEFAULTS["find-learnings-context"],
    promptName: "Find Learnings context",
    promptDescription:
      "Optional. Added to the prompt for finding cross-experiment Learnings: your product, audience, or what counts as a meaningful insight.",
    promptHelpText:
      "Optional. Leave blank to use only the built-in instructions. When set, this text is appended to the system prompt for find-learnings runs.",
  },
  {
    promptType: "experiment-hypothesis",
    promptDefaultValue: AI_PROMPT_DEFAULTS["experiment-hypothesis"],
    promptName: "Hypothesis format",
    promptDescription:
      "A style for hypotheses so they're consistent across experiments.",
    promptHelpText: "",
  },
  {
    promptType: "metric-description",
    promptDefaultValue: AI_PROMPT_DEFAULTS["metric-description"],
    promptName: "Metric description",
    promptDescription:
      "Writes a description when a metric is created. Describe the format you want.",
    promptHelpText:
      "Make sure to explain the format of the results you would like to see.",
  },
  {
    promptType: "generate-sql-query",
    promptDefaultValue: AI_PROMPT_DEFAULTS["generate-sql-query"],
    promptName: "Text to SQL",
    promptDescription:
      "Extra guidance for generated SQL. Database type, names, and table structures are included automatically.",
    overrideModelHelpText:
      "Some prompts are better than others at generating SQL.",
    promptHelpText:
      "Provide any additional guidance on how you would like SQL queries to be generated.",
  },
  {
    promptType: "product-analytics-chat",
    promptDefaultValue: AI_PROMPT_DEFAULTS["product-analytics-chat"],
    promptName: "Product Analytics AI analyst",
    promptDescription:
      "Optional. Your tone, naming, and policies for the Product Analytics assistant. Data Source context is included automatically.",
    promptHelpText:
      "Leave blank to use only the built-in assistant instructions. When set, this text is appended to the system prompt.",
    overrideModelHelpText:
      "Tool-heavy assistants often work better with a capable model.",
  },
];

const ApiKeyWarning: React.FC<{
  model?: string;
  hasKey: (model: AIModel | string) => boolean;
}> = ({ model, hasKey }) => {
  if (!model) return null;
  if (hasKey(model)) return null;
  const provider = getProviderForAIModel("text", model);
  if (provider === null) return null;
  return (
    <Box mt="2">
      <Callout status="warning">
        This model needs a {AI_PROVIDER_META[provider].label} API key. Add one
        under AI providers above.
      </Callout>
    </Box>
  );
};

const EmbeddingKeyWarning: React.FC<{
  embeddingModel: string;
  hasKey: (provider: AIProvider) => boolean;
}> = ({ embeddingModel, hasKey }) => {
  const provider = getProviderForAIModel("embedding", embeddingModel);
  if (provider === null) return null;
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

const SttKeyWarning: React.FC<{
  sttModel: string;
  hasKey: (provider: AIProvider) => boolean;
}> = ({ sttModel, hasKey }) => {
  const provider = getProviderForAIModel("stt", sttModel);
  if (provider === null) return null;
  if (hasKey(provider)) return null;
  return (
    <Box mt="2">
      <Callout status="warning">
        This dictation model needs a {AI_PROVIDER_META[provider].label} API key.
        Add one under AI providers above.
      </Callout>
    </Box>
  );
};

const modelOptionLabel = (
  option: { value: string; label: string },
  context: string,
  marked: { value: string; note: string } | null,
) => {
  if (!marked || context !== "menu" || option.value !== marked.value) {
    return <span>{option.label}</span>;
  }
  return (
    <Flex direction="column" gap="0">
      <Text>{option.label}</Text>
      <Text size="sm" color="text-mid">
        {marked.note}
      </Text>
    </Flex>
  );
};

export default function AISettings({
  promptForm,
}: {
  promptForm: UseFormReturn<PromptFormValues>;
}) {
  const form = useFormContext();
  const { apiCall } = useAuth();
  const { aiAgreedTo, defaultAIModel } = useAISettings();
  const [optInModal, setOptInModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [embeddingMsg, setEmbeddingMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { hasCommercialFeature, aiKeyProviders } = useUser();
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");
  const aiProviderAccess = useAIProviderKeys();
  const {
    hasKeyForModel,
    hasKeyForProvider,
    canChooseModels,
    selectableProviders: availableProviders,
  } = aiProviderAccess;

  const managedDefaultNote = isCloud()
    ? { value: "", note: getModelDisplayLabel(CLOUD_MANAGED_AI_MODEL) }
    : null;
  const orgDefaultNote = isCloud()
    ? { value: "", note: getModelDisplayLabel(defaultAIModel) }
    : null;
  // The dictation sentinel is offered in both deployments, so name the resolved model in both.
  const sttDefault = resolveDefaultSTTModel(aiKeyProviders);
  const sttDefaultNote = sttDefault
    ? { value: "", note: getModelDisplayLabel(sttDefault) }
    : null;

  // Same rule as the server: the cheap tier needs an Anthropic key (Cloud's
  // managed one counts); otherwise autocomplete runs on the org default.
  const autocompleteDefaultNote = {
    value: "",
    note: getModelDisplayLabel(
      isCloud() || hasKeyForProvider("anthropic")
        ? AUTOCOMPLETE_AI_MODEL
        : defaultAIModel,
    ),
  };

  const clearModelSettings = (keys: AIModelSettingKey[]) => {
    keys.forEach((key) => form.setValue(key, ""));
    mutatePrompts();
  };

  const permissionsUtil = usePermissionsUtil();
  const canEdit = permissionsUtil.canManageOrgSettings();
  const embeddingModel =
    form.watch("embeddingModel") || "text-embedding-ada-002";
  const embeddingProvider = getProviderForAIModel("embedding", embeddingModel);
  const hasEmbeddingKey =
    embeddingProvider === null || hasKeyForProvider(embeddingProvider);

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

  const {
    data,
    error: promptsError,
    mutate: mutatePrompts,
  } = useApi<{
    prompts: AIPromptInterface[];
  }>(`/ai/prompts`);

  const prompts = data ? PROMPTS : [];
  const PROMPT_GROUPS: {
    id: string;
    title: string;
    description: string;
    types: string[];
  }[] = [
    {
      id: "pr-exp",
      title: "Experiment prompts",
      description:
        "Prompts used for experiment analysis, Learnings, and hypotheses.",
      types: [
        "experiment-analysis",
        "find-learnings-context",
        "experiment-hypothesis",
      ],
    },
    {
      id: "pr-metrics",
      title: "Metrics & analytics prompts",
      description:
        "Prompts for metric descriptions, SQL generation, and the Product Analytics assistant.",
      types: [
        "metric-description",
        "generate-sql-query",
        "product-analytics-chat",
      ],
    },
  ];
  const groupedTypes = new Set(PROMPT_GROUPS.flatMap((g) => g.types));
  const promptGroups = [
    ...PROMPT_GROUPS,
    {
      id: "pr-other",
      title: "Other prompts",
      description: "Prompts used by other AI features.",
      types: prompts
        .map((p) => p.promptType)
        .filter((t) => !groupedTypes.has(t)),
    },
  ]
    .map((g) => ({
      ...g,
      prompts: g.types
        .map((t) => prompts.find((p) => p.promptType === t))
        .filter((p): p is (typeof prompts)[number] => !!p),
    }))
    .filter((g) => g.prompts.length > 0);
  const aiOn = form.watch("aiEnabled") && aiAgreedTo;

  const renderPrompt = (prompt: (typeof prompts)[number]) => (
    <SettingsField
      name={[
        `prompt.${prompt.promptType}`,
        `prompt.${prompt.promptType}-model`,
      ]}
      key={prompt.promptType}
      htmlFor={`prompt-${prompt.promptType}`}
      label={prompt.promptName}
      help={prompt.promptDescription}
      action={
        canEdit &&
        prompt.promptDefaultValue !== promptForm.watch(prompt.promptType) ? (
          <Link
            size="sm"
            title="Reset to the default AI prompt"
            onClick={() =>
              promptForm.setValue(
                prompt.promptType,
                prompt.promptDefaultValue,
                { shouldDirty: true },
              )
            }
          >
            Reset to default
          </Link>
        ) : null
      }
    >
      {canChooseModels && (
        <Box mb="2">
          <SelectField
            size="lg"
            id={`${prompt.promptType}-model`}
            label="Model"
            disabled={!canEdit}
            value={promptForm.watch(`${prompt.promptType}-model`) || ""}
            onChange={(v) =>
              promptForm.setValue(`${prompt.promptType}-model`, v, {
                shouldDirty: true,
              })
            }
            sort={false}
            options={getAvailablePromptModelOptions(
              availableProviders,
              promptForm.watch(`${prompt.promptType}-model`) || "",
            )}
            formatOptionLabel={(option, { context }) =>
              modelOptionLabel(option, context, orgDefaultNote)
            }
            helpText={prompt?.overrideModelHelpText || ""}
          />
          {promptForm.watch(`${prompt.promptType}-model`) ? (
            <ApiKeyWarning
              model={promptForm.watch(`${prompt.promptType}-model`) || ""}
              hasKey={hasKeyForModel}
            />
          ) : null}
        </Box>
      )}
      <Field
        size="md"
        textarea={true}
        id={`prompt-${prompt.promptType}`}
        placeholder=""
        disabled={!canEdit}
        containerClassName="mb-0"
        helpText={prompt.promptHelpText}
        {...promptForm.register(prompt.promptType)}
      />
    </SettingsField>
  );

  return (
    <>
      <SettingsGroup
        id="ai-access"
        title={
          <PremiumTooltip commercialFeature="ai-suggestions">
            Access
          </PremiumTooltip>
        }
        description="Turn AI features on or off across GrowthBook."
        keywords="ai llm enable ask your data natural language autocomplete assistant"
      >
        {!hasAISuggestions ? (
          <Text color="text-mid">AI features are available on paid plans.</Text>
        ) : (
          <>
            <UnsavedMark name="aiEnabled">
              <Checkbox
                id="toggle-aiEnabled"
                align="start"
                weight="medium"
                label="Enable AI features"
                value={form.watch("aiEnabled") && aiAgreedTo}
                setValue={(v) => {
                  if (v && !aiAgreedTo) {
                    setOptInModal(true);
                    return;
                  }
                  form.setValue("aiEnabled", v);
                }}
                disabled={!canEdit}
              />
            </UnsavedMark>
            {!canEdit && (
              <Callout status="info">
                You need permission to manage organization settings to change AI
                settings.
              </Callout>
            )}
            {aiOn && (
              <Flex direction="column" gap="4" pl="5">
                <UnsavedMark name="aiAskDataEnabled">
                  <Checkbox
                    id="toggle-aiAskDataEnabled"
                    align="start"
                    weight="medium"
                    label="Ask your data"
                    description="Ask questions about data in plain language. Schema, queries, and results are sent to the AI provider."
                    value={form.watch("aiAskDataEnabled") ?? false}
                    setValue={(v) => form.setValue("aiAskDataEnabled", v)}
                    disabled={!canEdit}
                  />
                </UnsavedMark>
                <UnsavedMark name="aiAutocompleteEnabled">
                  <Checkbox
                    id="toggle-aiAutocompleteEnabled"
                    align="start"
                    weight="medium"
                    label="AI Assistant autocomplete"
                    description="Suggest how to finish a message as users type in the AI Assistant. Each pause in typing is an AI call, so this adds to usage even when suggestions aren't accepted."
                    value={form.watch("aiAutocompleteEnabled") ?? true}
                    setValue={(v) => form.setValue("aiAutocompleteEnabled", v)}
                    disabled={!canEdit}
                  />
                </UnsavedMark>
              </Flex>
            )}
          </>
        )}
      </SettingsGroup>

      {hasAISuggestions && (
        <SettingsGroup
          id="ai-skills"
          title="Assistant Skills"
          description="What the AI Assistant can help with."
          keywords="ai assistant skills analytics experiments feature flags docs"
        >
          {aiOn ? (
            <AgentSkillsSettings canEdit={canEdit} />
          ) : (
            <Callout status="info">
              Turn on AI features in Access to change these.
            </Callout>
          )}
        </SettingsGroup>
      )}

      {(hasAISuggestions ||
        aiProviderAccess.error ||
        aiProviderAccess.credentials.length > 0) && (
        <SettingsGroup
          id="ai-providers"
          title="Providers"
          description="AI features use GrowthBook-managed keys by default. Add your own key to bill your provider directly and choose models. Keys are encrypted at rest."
          keywords="ai provider api key openai anthropic model embedding dictation autocomplete byok"
        >
          <AIProviderKeys
            access={aiProviderAccess}
            showPermissionCallout={false}
            aiEnabled={aiOn}
            onCleared={clearModelSettings}
          />

          {hasAISuggestions && form.watch("aiEnabled") && canChooseModels && (
            <>
              <SettingsField
                name="defaultAIModel"
                htmlFor="defaultAIModel"
                label="Default AI model"
                help="Used by every AI feature that doesn't override it."
              >
                <SelectField
                  size="lg"
                  id="defaultAIModel"
                  containerClassName="mb-0"
                  disabled={!canEdit}
                  value={form.watch("defaultAIModel") || ""}
                  onChange={(v) => form.setValue("defaultAIModel", v)}
                  sort={false}
                  options={[
                    ...(isCloud() ? [GROWTHBOOK_DEFAULT_MODEL_OPTION] : []),
                    ...getAvailableAIModelOptions(
                      availableProviders,
                      form.watch("defaultAIModel"),
                    ),
                  ]}
                  formatOptionLabel={(option, { context }) =>
                    modelOptionLabel(option, context, managedDefaultNote)
                  }
                />
                <ApiKeyWarning
                  model={
                    form.watch("defaultAIModel") ||
                    (isCloud() ? "" : "gpt-4o-mini")
                  }
                  hasKey={hasKeyForModel}
                />
              </SettingsField>
              <SettingsField
                name="embeddingModel"
                htmlFor="embeddingModel"
                label="Embedding model"
                help="Used for semantic search across experiments. Supports OpenAI, Mistral, and Google. Default is text-embedding-ada-002."
              >
                <SelectField
                  size="lg"
                  id="embeddingModel"
                  containerClassName="mb-0"
                  disabled={!canEdit}
                  value={
                    isCloud()
                      ? form.watch("embeddingModel") || ""
                      : form.watch("embeddingModel") || "text-embedding-ada-002"
                  }
                  onChange={(v) => form.setValue("embeddingModel", v)}
                  options={
                    isCloud()
                      ? getAvailableEmbeddingModelOptions(
                          availableProviders,
                          form.watch("embeddingModel") || "",
                        )
                      : EMBEDDING_MODEL_OPTIONS
                  }
                />
                <EmbeddingKeyWarning
                  embeddingModel={
                    form.watch("embeddingModel") || "text-embedding-ada-002"
                  }
                  hasKey={hasKeyForProvider}
                />
              </SettingsField>
              <SettingsField
                name="sttModel"
                htmlFor="sttModel"
                label="Dictation model"
                help="Used for voice dictation in AI chat. Supports OpenAI, xAI, and Mistral."
              >
                <SelectField
                  size="lg"
                  id="sttModel"
                  containerClassName="mb-0"
                  disabled={!canEdit}
                  value={form.watch("sttModel") || ""}
                  onChange={(v) => form.setValue("sttModel", v)}
                  options={getAvailableSTTModelOptions(
                    isCloud() ? availableProviders : undefined,
                    form.watch("sttModel") || "",
                  )}
                  formatOptionLabel={(option, { context }) =>
                    modelOptionLabel(option, context, sttDefaultNote)
                  }
                />
                {form.watch("sttModel") && (
                  <SttKeyWarning
                    sttModel={form.watch("sttModel")}
                    hasKey={hasKeyForProvider}
                  />
                )}
              </SettingsField>
              {(form.watch("aiAutocompleteEnabled") ?? true) && (
                <SettingsField
                  name="aiAutocompleteModel"
                  htmlFor="aiAutocompleteModel"
                  label="Autocomplete model"
                  help="Used for AI Assistant suggestions as users type. A small, fast model keeps them cheap and quick."
                >
                  <SelectField
                    size="lg"
                    id="aiAutocompleteModel"
                    containerClassName="mb-0"
                    disabled={!canEdit}
                    value={form.watch("aiAutocompleteModel") || ""}
                    onChange={(v) => form.setValue("aiAutocompleteModel", v)}
                    sort={false}
                    options={[
                      {
                        value: "",
                        label: "Use default autocomplete model",
                      },
                      ...getAvailableAIModelOptions(
                        availableProviders,
                        form.watch("aiAutocompleteModel"),
                      ),
                    ]}
                    formatOptionLabel={(option, { context }) =>
                      modelOptionLabel(option, context, autocompleteDefaultNote)
                    }
                  />
                  <ApiKeyWarning
                    model={form.watch("aiAutocompleteModel")}
                    hasKey={hasKeyForModel}
                  />
                </SettingsField>
              )}
            </>
          )}
        </SettingsGroup>
      )}

      {hasAISuggestions && form.watch("aiEnabled") && promptsError && (
        <Callout status="error" mb="3">
          Could not load AI prompts. {promptsError.message}
        </Callout>
      )}
      {hasAISuggestions && form.watch("aiEnabled") && data && (
        <>
          {promptGroups.map((group) => (
            <SettingsGroup
              key={group.id}
              id={group.id}
              title={group.title}
              description={group.description}
              keywords="ai llm prompt"
            >
              {group.prompts.map(renderPrompt)}
            </SettingsGroup>
          ))}

          {/* Visual Editor: per-surface model overrides + the brand-guidelines
              context that gets prepended to every visual-editor AI call (text
              edits + image gen). Brand context works on cloud and self-hosted;
              model pickers are gated on canChooseModels. */}
          <SettingsGroup
            id="pr-visual"
            title="Visual Editor"
            description="Context for AI in the Visual Editor Chrome extension."
            keywords="visual editor brand guidelines context image model text model"
          >
            <SettingsField
              name="visualEditorAIContext"
              htmlFor="visualEditorAIContext"
              label="Brand guidelines"
              help="Added to every Visual Editor AI prompt, for text edits and image generation."
            >
              <Field
                textarea={true}
                id="visualEditorAIContext"
                containerClassName="mb-0"
                disabled={!canEdit}
                placeholder={
                  'e.g. "We\'re a B2B SaaS company. Brand colors: #6E56CF and #1F2D5C. Sentence-case CTAs. Friendly but professional tone."'
                }
                {...form.register("visualEditorAIContext")}
              />
            </SettingsField>

            {canChooseModels && (
              <>
                <SettingsField
                  name="visualEditorAIModel"
                  htmlFor="visualEditorAIModel"
                  label="Visual Editor text model"
                  help="Used for AI chat edits and AI suggestions in the extension. Leave blank to use the Default AI model."
                >
                  <SelectField
                    size="lg"
                    id="visualEditorAIModel"
                    containerClassName="mb-0"
                    disabled={!canEdit}
                    value={form.watch("visualEditorAIModel") || ""}
                    onChange={(v) => form.setValue("visualEditorAIModel", v)}
                    sort={false}
                    options={[
                      USE_DEFAULT_MODEL_OPTION,
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
                </SettingsField>
                <SettingsField
                  name="visualEditorImageModel"
                  htmlFor="visualEditorImageModel"
                  label="Visual Editor image model"
                  help="Models that support reference images can use an existing image as visual context (the Visual Editor's “use current image” flow). Text-only models generate from the prompt alone."
                >
                  <SelectField
                    size="lg"
                    id="visualEditorImageModel"
                    containerClassName="mb-0"
                    disabled={!canEdit}
                    value={form.watch("visualEditorImageModel") || ""}
                    onChange={(v) => form.setValue("visualEditorImageModel", v)}
                    sort={false}
                    options={getAvailableImageModelOptions(
                      isCloud() ? availableProviders : undefined,
                      form.watch("visualEditorImageModel") || "",
                    )}
                  />
                </SettingsField>
              </>
            )}
          </SettingsGroup>

          <SettingsGroup
            id="ai-embeddings"
            title="Embeddings"
            description="Used to find related experiments and summarize them. Similarity scores update automatically."
            keywords="embeddings related experiments semantic regenerate"
          >
            <SettingsField
              label="Regenerate embeddings"
              help="Use this if related experiments look wrong."
            >
              <Button
                onClick={handleRegenerate}
                disabled={loading || !hasEmbeddingKey || !canEdit}
                variant="soft"
              >
                {loading ? "Regenerating..." : "Regenerate all"}
              </Button>
              <EmbeddingKeyWarning
                embeddingModel={embeddingModel}
                hasKey={hasKeyForProvider}
              />
              {error && (
                <Callout status="error" mt="3">
                  {error}
                </Callout>
              )}
              {embeddingMsg && <Box mt="3">{embeddingMsg}</Box>}
            </SettingsField>
          </SettingsGroup>
        </>
      )}
      {optInModal && (
        <OptInModal agreement="ai" onClose={() => setOptInModal(false)} />
      )}
    </>
  );
}
