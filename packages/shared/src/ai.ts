import { parseOptionalInt } from "./util/numbers";

// AI Provider types and configurations
export type AIProvider = "openai" | "anthropic" | "xai" | "mistral" | "google";

// Available text generation models for each provider
export const AI_PROVIDER_MODEL_MAP = {
  openai: [
    // GPT-5 series
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.2",
    "gpt-5.2-pro",
    "gpt-5.1-codex",
    "gpt-5.1-codex-max",
    "gpt-5.1-codex-mini",
    "gpt-5",
    "gpt-5-nano",
    "gpt-5-mini",
    "gpt-5-pro",
    "gpt-5-codex",
    // GPT-4 series
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o",
    "gpt-4o-mini",
    // O series (reasoning models)
    "o4-mini",
    "o3",
    "o3-mini",
    "o1",
  ],
  anthropic: [
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-5-20250929",
    "claude-opus-4-1-20250805",
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-haiku-20241022",
    "claude-3-haiku-20240307",
  ],
  xai: [
    "grok-code-fast-1",
    "grok-4-fast-non-reasoning",
    "grok-4-fast-reasoning",
    "grok-4",
    "grok-3",
    "grok-3-mini",
    "grok-3-fast",
    "grok-3-mini-fast",
    "grok-2",
  ],
  mistral: ["mistral-small", "mistral-medium", "pixtral-12b"],
  google: [
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-pro-latest",
  ],
} as const;

// Derive AIModel type from the models defined in AI_PROVIDER_MODEL_MAP
export type AIModel = (typeof AI_PROVIDER_MODEL_MAP)[AIProvider][number];

// Helper to determine which provider a model belongs to
export function getProviderFromModel(model: AIModel): AIProvider {
  for (const [provider, models] of Object.entries(AI_PROVIDER_MODEL_MAP)) {
    if (models.includes(model as never)) {
      return provider as AIProvider;
    }
  }
  throw new Error(`Model ${model} is not supported.`);
}

// ============================================================================
// Image generation models
// ----------------------------------------------------------------------------
// Two flavors live behind this registry:
//
//   • "image-endpoint" — providers with a dedicated text-to-image endpoint
//     (OpenAI DALL-E / GPT Image, Google Imagen, xAI Grok Image). On the
//     back-end these go through Vercel AI SDK's `generateImage(provider.image(id))`.
//
//   • "multimodal-text" — language models that emit image bytes alongside
//     (or instead of) text in a normal `generateContent` call. Gemini 2.5
//     Flash Image ("nano-banana") and Gemini 3 Pro Image are the canonical
//     examples. On the back-end these go through `generateText(provider(id))`
//     with `responseModalities: ['IMAGE']` and we read `result.files`. These
//     are also the only models that currently accept reference images via
//     the unified abstraction (image bytes as a multimodal input part).
//
// Adding a new image model = add an entry here. The back-end's image
// generation service dispatches off `provider` + `kind`, and the front-end
// AI Settings dropdown reads `label` directly.
// ============================================================================

export type AIImageProvider = "openai" | "google" | "xai";

export type AIImageModelKind = "image-endpoint" | "multimodal-text";

export interface AIImageModelMeta {
  // Canonical model id passed to the Vercel SDK. For Google, the *bare*
  // names like `gemini-2.5-flash-image` are aliased to the preview names
  // on the SDK side — see resolveImageModelIdForSdk.
  id: string;
  provider: AIImageProvider;
  kind: AIImageModelKind;
  // Human-readable label shown in the AI Settings dropdown.
  label: string;
  // Whether the model accepts a reference image (the AI image-replace
  // panel uses this to gate the "Use current image as context" toggle).
  supportsReferenceImage: boolean;
}

export const AI_IMAGE_MODELS: ReadonlyArray<AIImageModelMeta> = [
  // Google multimodal-text (nano-banana lineage). The model was
  // promoted out of preview in late 2025; the GA endpoint is
  // `gemini-2.5-flash-image` and the old `-preview` path returns
  // "model not found for API version v1beta" via generateContent.
  // Orgs that stored the preview id are mapped forward via
  // IMAGE_MODEL_ALIASES below.
  {
    id: "gemini-2.5-flash-image",
    provider: "google",
    kind: "multimodal-text",
    label: "Gemini 2.5 Flash Image (nano-banana)",
    supportsReferenceImage: true,
  },
  {
    id: "gemini-3-pro-image-preview",
    provider: "google",
    kind: "multimodal-text",
    label: "Gemini 3 Pro Image (preview)",
    supportsReferenceImage: true,
  },
  // Google Imagen (dedicated endpoint)
  {
    id: "imagen-4.0-fast-generate-001",
    provider: "google",
    kind: "image-endpoint",
    label: "Imagen 4 Fast",
    supportsReferenceImage: false,
  },
  {
    id: "imagen-4.0-generate-001",
    provider: "google",
    kind: "image-endpoint",
    label: "Imagen 4",
    supportsReferenceImage: false,
  },
  {
    id: "imagen-4.0-ultra-generate-001",
    provider: "google",
    kind: "image-endpoint",
    label: "Imagen 4 Ultra",
    supportsReferenceImage: false,
  },
  // OpenAI
  {
    id: "dall-e-3",
    provider: "openai",
    kind: "image-endpoint",
    label: "DALL-E 3",
    supportsReferenceImage: false,
  },
  {
    id: "gpt-image-1",
    provider: "openai",
    kind: "image-endpoint",
    label: "GPT Image 1",
    supportsReferenceImage: false,
  },
  {
    id: "gpt-image-1-mini",
    provider: "openai",
    kind: "image-endpoint",
    label: "GPT Image 1 Mini",
    supportsReferenceImage: false,
  },
  // xAI
  {
    id: "grok-2-image",
    provider: "xai",
    kind: "image-endpoint",
    label: "Grok 2 Image",
    supportsReferenceImage: false,
  },
];

// Legacy → SDK id aliases. Used to map model ids that orgs may have
// previously stored in their settings onto the id the SDK / provider
// currently accepts. Mapped at the dispatch boundary so old settings
// keep working without a settings migration.
//
// Currently mapped:
//   - `gemini-2.5-flash-image-preview` → `gemini-2.5-flash-image`
//     (Google promoted nano-banana out of preview; the `-preview`
//      suffix path now 404s at v1beta `generateContent`.)
const IMAGE_MODEL_ALIASES: Record<string, string> = {
  "gemini-2.5-flash-image-preview": "gemini-2.5-flash-image",
};

export function resolveImageModelIdForSdk(model: string): string {
  return IMAGE_MODEL_ALIASES[model] ?? model;
}

export function getImageModelMeta(model: string): AIImageModelMeta | undefined {
  const resolved = resolveImageModelIdForSdk(model);
  return AI_IMAGE_MODELS.find((m) => m.id === resolved);
}

// Available embedding models for each provider
export const AI_PROVIDER_EMBEDDING_MODEL_MAP = {
  openai: [
    "text-embedding-3-small",
    "text-embedding-3-large",
    "text-embedding-ada-002",
  ],
  mistral: ["mistral-embed", "codestral-embed"],
  google: [
    "text-embedding-005",
    "text-multilingual-embedding-002",
    "gemini-embedding-001",
  ],
} as const;

// Derive EmbeddingModel type from the models defined in AI_PROVIDER_EMBEDDING_MODEL_MAP
export type EmbeddingModel =
  (typeof AI_PROVIDER_EMBEDDING_MODEL_MAP)[keyof typeof AI_PROVIDER_EMBEDDING_MODEL_MAP][number];

// Helper to determine which provider an embedding model belongs to
export function getProviderFromEmbeddingModel(
  model: EmbeddingModel,
): AIProvider {
  for (const [provider, models] of Object.entries(
    AI_PROVIDER_EMBEDDING_MODEL_MAP,
  )) {
    if (models.includes(model as never)) {
      return provider as AIProvider;
    }
  }
  throw new Error(`Embedding model ${model} is not supported.`);
}

export interface AITokenUsageInterface {
  id?: string;
  organization: string;
  numTokensUsed: number;
  lastResetAt: number;
  dailyLimit: number;
}

export const AI_PROMPT_TYPES = [
  "experiment-analysis",
  "metric-description",
  "experiment-hypothesis",
  "generate-sql-query",
  "generate-experiment-keywords",
  "visual-changeset-copy-transform-energetic",
  "visual-changeset-copy-transform-concise",
  "visual-changeset-copy-transform-humorous",
  "visual-editor-ai-edit",
  "visual-editor-ai-suggestions",
  "visual-editor-ai-image-gen",
  "product-analytics-chat",
] as const;
export type AIPromptType = (typeof AI_PROMPT_TYPES)[number];

export interface AIPromptInterface {
  id?: string;
  organization: string;
  type: AIPromptType;
  prompt: string;
  overrideModel?: string;
}

export const AI_PROMPT_DEFAULTS: Record<AIPromptType, string> = {
  "experiment-analysis":
    "Provide a justification for the chosen outcome of the experiment based on the snapshot data" +
    "\nIf the chosen outcome is 'dnf' your output should be in the form 'We are not finishing the experiment because ...' and provide a reason such as that the experiment was underpowered and would take too long to complete.  It needs no sections at all." +
    "\nOtherwise your output should be in the form of two sections '### Key Findings' and '### Conclusions'." +
    "\nFor the Key Findings you should list which metrics had statistically significant winners and by how much, and name the metrics that are unchanged." +
    "\nWhen listing CRs please make sure to use the correct format given the metric type." +
    "\nFor the Conclusions where you state the name of the winning variation and a good, but brief rationale behind that based upon the results of the metrics." +
    "\nThere should be no other headers or sections in your response besides '### Key Findings' and '### Conclusions'" +
    "\nYour output should be in the form of a markdown text, and should be no longer than 2000 characters." +
    "\nIt should not be wrapped in triple backticks." +
    "\nThere is no need to provide metric ids in your answer",
  "metric-description":
    "Write a concise description in markdown of the metric that will be helpful for other users who may want to use this metric in their AB tests. Paraphrase what this metric is used to show or measure.",
  "experiment-hypothesis":
    "A hypothesis is a statement that can be tested. It should be clear, concise, specific, and falsifiable. It should include how the user or product behavior is expected to change, and what metrics we're trying to move with this experiment. It does not need a title.",
  "generate-sql-query": "",
  "generate-experiment-keywords": "", // Always uses the default prompt set in ExperimentModel.ts
  "visual-changeset-copy-transform-energetic": "", // Always uses the default prompt set in postCopyTransform.ts
  "visual-changeset-copy-transform-concise": "", // Always uses the default prompt set in postCopyTransform.ts
  "visual-changeset-copy-transform-humorous": "", // Always uses the default prompt set in postCopyTransform.ts
  "visual-editor-ai-edit": "", // Always uses the default prompt set in postAIEdit.ts
  "visual-editor-ai-suggestions": "", // Always uses the default prompt set in postAISuggestions.ts
  "visual-editor-ai-image-gen": "", // Image generation does not currently use a text prompt template
  "product-analytics-chat": "",
};

// Prompt types that have default values and can be customized by users
export const CUSTOMIZABLE_PROMPT_TYPES = Object.keys(AI_PROMPT_DEFAULTS).filter(
  (key) =>
    AI_PROMPT_DEFAULTS[key as AIPromptType] !== "" ||
    key === "generate-sql-query" ||
    key === "product-analytics-chat",
) as AIPromptType[];

export interface AIUsageData {
  fieldMatchesAI?: boolean;
  fieldLength?: number;
  suggestionLength?: number;
  fieldExists: boolean;
  suggestionExists: boolean;
}

export type AISuggestionType = "suggest" | "try-again";

export function computeAIUsageData({
  value,
  aiSuggestionText,
}: {
  value: string;
  aiSuggestionText?: string;
}): AIUsageData {
  return {
    fieldMatchesAI:
      aiSuggestionText && value
        ? value.toLowerCase().includes(aiSuggestionText.toLowerCase())
        : undefined,
    fieldLength: value?.length,
    suggestionLength: aiSuggestionText?.length,
    fieldExists: !!value,
    suggestionExists: !!aiSuggestionText,
  };
}

const AI_RATE_LIMIT_GENERIC =
  "You have reached the AI request limit. Please try again later.";

function pluralUnit(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Human-readable AI rate-limit message from optional `Retry-After` seconds */
export function formatAIRateLimitRetryMessage(
  retryAfterSeconds: unknown,
): string {
  const s = parseOptionalInt(retryAfterSeconds);
  if (s === undefined) return AI_RATE_LIMIT_GENERIC;
  if (s <= 0) return AI_RATE_LIMIT_GENERIC;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (hours === 0 && minutes === 0) {
    return `You have reached the AI request limit. Try again in less than a minute.`;
  }
  const hourPart = hours > 0 ? pluralUnit(hours, "hour", "hours") : "";
  const minutePart =
    minutes > 0 ? pluralUnit(minutes, "minute", "minutes") : "";
  if (hourPart && minutePart) {
    return `You have reached the AI request limit. Try again in ${hourPart} and ${minutePart}.`;
  }
  return `You have reached the AI request limit. Try again in ${hourPart || minutePart}.`;
}
