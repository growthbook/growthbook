import type { AIModel, AIProvider } from "shared/ai";
import { AI_PROVIDER_MODEL_MAP } from "shared/ai";
import {
  hasOpenAIKey,
  hasAnthropicKey,
  hasXaiKey,
  hasMistralKey,
  hasGoogleAIKey,
} from "@/services/env";

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

function hasKeyForProvider(provider: AIProvider): boolean {
  if (provider === "openai") return hasOpenAIKey();
  if (provider === "anthropic") return hasAnthropicKey();
  if (provider === "xai") return hasXaiKey();
  if (provider === "mistral") return hasMistralKey();
  if (provider === "google") return hasGoogleAIKey();
  return false;
}

/**
 * Returns model options filtered to providers with configured API keys, always
 * grouped by provider. Falls back to showing all models if no keys are configured yet.
 */
export function getAvailableAIModelOptions(): GroupedOption[] {
  const allProviders = Object.keys(AI_PROVIDER_MODEL_MAP) as AIProvider[];
  const availableProviders = allProviders.filter(hasKeyForProvider);

  // Fall back to all providers if none have keys yet (e.g., during initial setup)
  const providers =
    availableProviders.length > 0 ? availableProviders : allProviders;

  return providers.map((provider) => ({
    label: PROVIDER_DISPLAY_NAMES[provider],
    options: AI_PROVIDER_MODEL_MAP[provider].map((value) => ({
      value,
      label: AI_MODEL_DISPLAY_LABELS[value as AIModel] ?? value,
    })),
  }));
}

/**
 * Per-prompt model override options with an "org default" sentinel prepended.
 * Filtered and grouped the same way as getAvailableAIModelOptions().
 */
export function getAvailablePromptModelOptions(): (
  | FlatOption
  | GroupedOption
)[] {
  return [
    { value: "", label: "-- Use Default AI Model --" },
    ...getAvailableAIModelOptions(),
  ];
}
