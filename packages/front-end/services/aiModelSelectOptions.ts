import type { AIModel, AIProvider, EmbeddingModel } from "shared/ai";
import {
  AI_IMAGE_MODELS,
  AI_PROVIDER_MODEL_MAP,
  DEFAULT_EMBEDDING_MODEL,
  getImageModelMeta,
  getProviderForAIModel,
} from "shared/ai";
import { ensureValuesExactlyMatchUnion } from "shared/util";

type FlatOption = { value: string; label: string };
type GroupedOption = { label: string; options: FlatOption[] };

const PROVIDER_DISPLAY_NAMES: Record<AIProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  xai: "xAI",
  mistral: "Mistral",
  google: "Google",
};

/** Human-readable display names for all AI models, without vendor prefix. */
export const AI_MODEL_DISPLAY_LABELS: Record<AIModel, string> = {
  // OpenAI GPT-5 series
  "gpt-5.4-mini": "GPT 5.4 Mini",
  "gpt-5.4-nano": "GPT 5.4 Nano",
  "gpt-5.2": "GPT 5.2",
  "gpt-5.2-pro": "GPT 5.2 Pro",
  "gpt-5.1-codex": "GPT 5.1 Codex",
  "gpt-5.1-codex-max": "GPT 5.1 Codex Max",
  "gpt-5.1-codex-mini": "GPT 5.1 Codex Mini",
  "gpt-5": "GPT 5",
  "gpt-5-nano": "GPT 5 Nano",
  "gpt-5-mini": "GPT 5 Mini",
  "gpt-5-pro": "GPT 5 Pro",
  "gpt-5-codex": "GPT 5 Codex",
  // OpenAI GPT-4 series
  "gpt-4.1": "GPT 4.1",
  "gpt-4.1-mini": "GPT 4.1 Mini",
  "gpt-4.1-nano": "GPT 4.1 Nano",
  "gpt-4o": "GPT 4o",
  "gpt-4o-mini": "GPT 4o Mini",
  // OpenAI O series (reasoning models)
  "o4-mini": "O4 Mini",
  o3: "O3",
  "o3-mini": "O3 Mini",
  o1: "O1",
  // Anthropic Claude
  "claude-sonnet-4-6": "Claude 4.6 Sonnet",
  "claude-haiku-4-5-20251001": "Claude 4.5 Haiku (20251001)",
  "claude-sonnet-4-5-20250929": "Claude 4.5 Sonnet (20250929)",
  "claude-opus-4-1-20250805": "Claude 4.1 Opus (20250805)",
  "claude-opus-4-20250514": "Claude 4 Opus (20250514)",
  "claude-sonnet-4-20250514": "Claude 4 Sonnet (20250514)",
  "claude-3-7-sonnet-20250219": "Claude 3.7 Sonnet (20250219)",
  "claude-3-5-haiku-20241022": "Claude 3.5 Haiku (20241022)",
  "claude-3-haiku-20240307": "Claude 3 Haiku (20240307)",
  // xAI Grok
  "grok-code-fast-1": "Grok Code Fast 1",
  "grok-4-fast-non-reasoning": "Grok 4 Fast Non-Reasoning",
  "grok-4-fast-reasoning": "Grok 4 Fast Reasoning",
  "grok-4": "Grok 4",
  "grok-3": "Grok 3",
  "grok-3-mini": "Grok 3 Mini",
  "grok-3-fast": "Grok 3 Fast",
  "grok-3-mini-fast": "Grok 3 Mini Fast",
  "grok-2": "Grok 2",
  // Mistral
  "mistral-small": "Mistral Small",
  "mistral-medium": "Mistral Medium",
  "pixtral-12b": "Pixtral 12B",
  // Google Gemini
  "gemini-3-pro-preview": "Gemini 3 Pro Preview",
  "gemini-3-flash-preview": "Gemini 3 Flash Preview",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.0-flash": "Gemini 2.0 Flash",
  "gemini-2.0-flash-lite": "Gemini 2.0 Flash Lite",
  "gemini-flash-latest": "Gemini Flash Latest",
  "gemini-flash-lite-latest": "Gemini Flash Lite Latest",
  "gemini-pro-latest": "Gemini Pro Latest",
};

/** Embedding models, labeled with the provider that serves them. */
export const EMBEDDING_MODEL_OPTIONS =
  ensureValuesExactlyMatchUnion<EmbeddingModel>()([
    // OpenAI embeddings
    {
      value: "text-embedding-3-small",
      label: "OpenAI: text-embedding-3-small",
    },
    {
      value: "text-embedding-3-large",
      label: "OpenAI: text-embedding-3-large",
    },
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

function withSelectedOption<T extends FlatOption | GroupedOption>(
  options: T[],
  selected: string | undefined,
  label: (value: string) => string,
): (T | GroupedOption)[] {
  if (!selected) return options;
  const present = options.some((o) =>
    "options" in o
      ? o.options.some((s) => s.value === selected)
      : o.value === selected,
  );
  if (present) return options;
  return [
    {
      label: "Selected, no API key",
      options: [{ value: selected, label: label(selected) }],
    },
    ...options,
  ];
}

export function getAvailableAIModelOptions(
  availableProviders: readonly AIProvider[] | undefined,
  selectedModel?: string,
): (FlatOption | GroupedOption)[] {
  const allProviders = Object.keys(AI_PROVIDER_MODEL_MAP) as AIProvider[];

  const filtered =
    availableProviders === undefined
      ? allProviders
      : allProviders.filter((p) => availableProviders.includes(p));

  const providers = filtered.length > 0 ? filtered : allProviders;

  const groups = providers
    .map((provider) => ({
      label: PROVIDER_DISPLAY_NAMES[provider],
      options: AI_PROVIDER_MODEL_MAP[provider].map((value) => ({
        value,
        label: AI_MODEL_DISPLAY_LABELS[value as AIModel] ?? value,
      })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return withSelectedOption(
    groups,
    selectedModel,
    (value) => AI_MODEL_DISPLAY_LABELS[value as AIModel] ?? value,
  );
}

/**
 * "Leave this unset and inherit the default" — the same entry, worded the same
 * way, in every model picker. What it inherits differs by field (the org
 * default, or GrowthBook's managed model for the org default itself), but to
 * the person choosing it always means "I'm not picking one".
 */
export const USE_DEFAULT_MODEL_OPTION = {
  value: "",
  label: "Use default AI model",
};

/** Names the embedding fallback: "default AI model" reads as the chat model. */
export const USE_DEFAULT_EMBEDDING_MODEL_OPTION = {
  value: "",
  label: `Use default (${DEFAULT_EMBEDDING_MODEL})`,
};

/**
 * Clears the org's own default and hands the choice back to GrowthBook. Always
 * offered on Cloud — it is the only way back once a model is pinned, or once
 * the pinned one's provider key is removed.
 */
export const GROWTHBOOK_DEFAULT_MODEL_OPTION = {
  value: "",
  label: "GrowthBook default model",
};

/** Display name for any model id — text, image or embedding. */
export function getModelDisplayLabel(model: string): string {
  return (
    AI_MODEL_DISPLAY_LABELS[model as AIModel] ??
    getImageModelMeta(model)?.label ??
    EMBEDDING_MODEL_OPTIONS.find((o) => o.value === model)?.label ??
    model
  );
}

/**
 * Per-prompt model override options with an "org default" sentinel prepended.
 * Filtered and grouped the same way as getAvailableAIModelOptions().
 */
export function getAvailablePromptModelOptions(
  availableProviders: readonly AIProvider[] | undefined,
  selectedModel?: string,
): (FlatOption | GroupedOption)[] {
  return [
    USE_DEFAULT_MODEL_OPTION,
    ...getAvailableAIModelOptions(availableProviders, selectedModel),
  ];
}

/**
 * Image-generation model options, filtered like getAvailableAIModelOptions().
 * Grouped by reference-image support rather than by provider: that capability
 * decides whether the Visual Editor's "use current image" flow works at all.
 * The leading "use default" entry always stays — it needs no key of its own.
 */
export function getAvailableImageModelOptions(
  availableProviders: readonly AIProvider[] | undefined,
  selectedModel?: string,
): (FlatOption | GroupedOption)[] {
  const models =
    availableProviders === undefined
      ? AI_IMAGE_MODELS
      : AI_IMAGE_MODELS.filter((m) => availableProviders.includes(m.provider));

  const group = (label: string, supportsReferenceImage: boolean) => {
    const options = models
      .filter((m) => m.supportsReferenceImage === supportsReferenceImage)
      .map((m) => ({ value: m.id, label: m.label }));
    return options.length ? [{ label, options }] : [];
  };

  return withSelectedOption(
    [
      { value: "", label: "Use default (Gemini 2.5 Flash Image)" },
      ...group("Supports reference image", true),
      ...group("Text prompt only", false),
    ],
    selectedModel,
    (value) => getImageModelMeta(value)?.label ?? value,
  );
}

export function getAvailableEmbeddingModelOptions(
  availableProviders: readonly AIProvider[] | undefined,
  selectedModel?: string,
): (FlatOption | GroupedOption)[] {
  const options =
    availableProviders === undefined
      ? EMBEDDING_MODEL_OPTIONS
      : EMBEDDING_MODEL_OPTIONS.filter((o) => {
          const provider = getProviderForAIModel("embedding", o.value);
          return provider === null || availableProviders.includes(provider);
        });

  return withSelectedOption(
    [USE_DEFAULT_EMBEDDING_MODEL_OPTION, ...options],
    selectedModel,
    (value) =>
      EMBEDDING_MODEL_OPTIONS.find((o) => o.value === value)?.label ?? value,
  );
}
