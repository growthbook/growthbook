import type { AIModel } from "shared/ai";
import { ensureValuesExactlyMatchUnion } from "shared/util";

/** Labeled options for org default AI model (no empty sentinel). */
export const AI_MODEL_LABELS = ensureValuesExactlyMatchUnion<AIModel>()([
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

/** Per-prompt model override: first value is org default resolution. */
export const PROMPT_MODEL_LABELS = [
  { value: "", label: "-- Use Default AI Model --" },
  ...AI_MODEL_LABELS,
];
