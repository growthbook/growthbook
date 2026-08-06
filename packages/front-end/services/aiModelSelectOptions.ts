import type { AIModel, AIProvider, EmbeddingModel } from "shared/ai";
import {
  AI_PROVIDER_MODEL_MAP,
  getProviderFromEmbeddingModel,
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

// Keeps the saved model selectable even when its provider has no key —
// otherwise SelectField renders empty while the form still holds that model.
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

/**
 * Model options grouped by provider, restricted to the providers this org can
 * reach. Callers pass those in because the front-end server's env flags can't
 * see org-stored keys. Empty falls back to every provider, so a fresh install
 * still shows a full picker.
 *
 * Groups are alphabetical; models keep the registry's newest-first order, so
 * callers must pass `sort={false}` to SelectField or it re-sorts by label.
 */
export function getAvailableAIModelOptions(
  availableProviders: readonly AIProvider[],
  selectedModel?: string,
): (FlatOption | GroupedOption)[] {
  const allProviders = Object.keys(AI_PROVIDER_MODEL_MAP) as AIProvider[];

  // Filter the full list rather than mapping availableProviders, so provider
  // order doesn't depend on the order keys happen to be stored in.
  const providers = availableProviders.length
    ? allProviders.filter((p) => availableProviders.includes(p))
    : allProviders;

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
 * Per-prompt model override options with an "org default" sentinel prepended.
 * Filtered and grouped the same way as getAvailableAIModelOptions().
 */
export function getAvailablePromptModelOptions(
  availableProviders: readonly AIProvider[],
  selectedModel?: string,
): (FlatOption | GroupedOption)[] {
  return [
    { value: "", label: "-- Use Default AI Model --" },
    ...getAvailableAIModelOptions(availableProviders, selectedModel),
  ];
}

/**
 * Embedding model options, restricted to providers with a key the same way as
 * getAvailableAIModelOptions(). Embedding models live in their own registry, so
 * they need their own model → provider lookup.
 */
export function getAvailableEmbeddingModelOptions(
  availableProviders: readonly AIProvider[],
  selectedModel?: string,
): (FlatOption | GroupedOption)[] {
  const available = availableProviders.length
    ? EMBEDDING_MODEL_OPTIONS.filter((o) => {
        try {
          return availableProviders.includes(
            getProviderFromEmbeddingModel(o.value),
          );
        } catch {
          // Unknown provider mapping — keep the option rather than hide it.
          return true;
        }
      })
    : EMBEDDING_MODEL_OPTIONS;

  const options = available.length ? available : [...EMBEDDING_MODEL_OPTIONS];

  return withSelectedOption(
    [...options],
    selectedModel,
    (value) =>
      EMBEDDING_MODEL_OPTIONS.find((o) => o.value === value)?.label ?? value,
  );
}
