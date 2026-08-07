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
    // Intentional rolling alias — Anthropic hasn't published a dated snapshot
    // for Sonnet 4.6 yet, so this tracks the latest build. Pin to a dated id
    // (claude-sonnet-4-6-YYYYMMDD) here once one exists if you need stable
    // behaviour. The other Claude entries are dated for exactly that reason.
    "claude-sonnet-4-6",
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

// OpenAI reasoning models (the o-series and the entire GPT-5 family) are
// served through the Responses API and reject the `temperature`
// parameter — the AI SDK logs a warning and silently drops it. Callers
// should omit `temperature` for these models. Non-reasoning OpenAI models
// (gpt-4*, gpt-4o*) and every other provider still accept it.
export function isReasoningModel(model: AIModel): boolean {
  return /^(o[0-9]|gpt-5)/.test(model);
}

// Whether a text model can accept image input (vision). The model
// registry carries no capability metadata, so this is a hand-maintained
// allow-list — keep it in sync with AI_PROVIDER_MODEL_MAP. Routing an
// image to a text-only model fails opaquely at the provider, so callers
// that attach an image MUST gate on this.
export function isVisionCapableModel(model: AIModel): boolean {
  // All Gemini models are multimodal.
  if (model.startsWith("gemini-")) return true;
  // All Claude 3+ models (3, 3.5, 3.7, 4.x) accept image input.
  if (model.startsWith("claude-")) return true;
  // OpenAI: gpt-4o*, gpt-4.1*, and the gpt-5 family see images. The
  // o-series reasoning models do not.
  if (/^gpt-4o/.test(model)) return true;
  if (/^gpt-4\.1/.test(model)) return true;
  if (/^gpt-5/.test(model)) return true;
  // Mistral: only the Pixtral vision model.
  if (model === "pixtral-12b") return true;
  // xAI: the grok-4 family is multimodal; grok-3/grok-2 are not.
  if (/^grok-4/.test(model)) return true;
  return false;
}

// Pick a vision-capable text model for a design-analysis turn. Prefers the
// org's configured visual-editor model when it can see images; otherwise
// falls back to a strong vision model on whichever provider has a key,
// Google → OpenAI → Anthropic. Returns null when no vision-capable
// provider is available (caller should surface a helpful error).
export function pickVisionModel(settings: {
  visualEditorAIModel?: AIModel;
  openAIAPIKey?: string;
  anthropicAPIKey?: string;
  googleAPIKey?: string;
}): AIModel | null {
  if (
    settings.visualEditorAIModel &&
    isVisionCapableModel(settings.visualEditorAIModel)
  ) {
    return settings.visualEditorAIModel;
  }
  if (settings.googleAPIKey) return "gemini-2.5-pro";
  if (settings.openAIAPIKey) return "gpt-4o";
  if (settings.anthropicAPIKey) return "claude-sonnet-4-5-20250929";
  return null;
}

// Image generation model registry. Add new models here — back-end
// dispatches off `provider` + `kind`; front-end reads `label`.
// `kind`:
//   "image-endpoint"   = dedicated text-to-image endpoint (DALL-E, Imagen, Grok)
//   "multimodal-text"  = LM that emits image bytes (Gemini *-image); the only
//                        kind that currently accepts reference images.

export type AIImageProvider = "openai" | "google" | "xai";

export type AIImageModelKind = "image-endpoint" | "multimodal-text";

export interface AIImageModelMeta {
  // Canonical SDK model id. See resolveImageModelIdForSdk for aliases.
  id: string;
  provider: AIImageProvider;
  kind: AIImageModelKind;
  // Human-readable label for the AI Settings dropdown.
  label: string;
  supportsReferenceImage: boolean;
  // Aspect ratios this model can actually be steered to. A requested ratio
  // is snapped to the closest entry here before generation, so we never
  // hand a model (e.g. gpt-image-1) a ratio it rejects.
  supportedAspectRatios: readonly string[];
  // Whether the model respects a programmatic aspect-ratio hint
  // (`imageConfig.aspectRatio` for Gemini, the `aspectRatio`/size arg for
  // dedicated endpoints). When false (e.g. gemini-2.5-flash-image), the
  // output shape is unpredictable and the only reliable lever is the text
  // prompt — so the framing/safe-area instruction is always applied.
  honorsAspectRatio: boolean;
}

// Ratios Gemini 3 Pro Image accepts via imageConfig.aspectRatio.
const GEMINI_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

export const AI_IMAGE_MODELS: ReadonlyArray<AIImageModelMeta> = [
  // Google multimodal-text (nano-banana lineage). The old `-preview`
  // path 404s at v1beta now; legacy ids are remapped via
  // IMAGE_MODEL_ALIASES.
  {
    id: "gemini-2.5-flash-image",
    provider: "google",
    kind: "multimodal-text",
    label: "Gemini 2.5 Flash Image (nano-banana)",
    supportsReferenceImage: true,
    // Ignores imageConfig.aspectRatio, so output shape is driven entirely
    // by the prompt. The extra-wide/tall entries give the framing
    // instruction a cleaner target for banner-shaped slots.
    supportedAspectRatios: [...GEMINI_ASPECT_RATIOS, "3:1", "1:3"],
    honorsAspectRatio: false,
  },
  {
    id: "gemini-3-pro-image-preview",
    provider: "google",
    kind: "multimodal-text",
    label: "Gemini 3 Pro Image (preview)",
    supportsReferenceImage: true,
    supportedAspectRatios: GEMINI_ASPECT_RATIOS,
    honorsAspectRatio: true,
  },
  // Google Imagen (dedicated endpoint)
  {
    id: "imagen-4.0-fast-generate-001",
    provider: "google",
    kind: "image-endpoint",
    label: "Imagen 4 Fast",
    supportsReferenceImage: false,
    supportedAspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
    honorsAspectRatio: true,
  },
  {
    id: "imagen-4.0-generate-001",
    provider: "google",
    kind: "image-endpoint",
    label: "Imagen 4",
    supportsReferenceImage: false,
    supportedAspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
    honorsAspectRatio: true,
  },
  {
    id: "imagen-4.0-ultra-generate-001",
    provider: "google",
    kind: "image-endpoint",
    label: "Imagen 4 Ultra",
    supportsReferenceImage: false,
    supportedAspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
    honorsAspectRatio: true,
  },
  // OpenAI
  {
    id: "dall-e-3",
    provider: "openai",
    kind: "image-endpoint",
    label: "DALL-E 3",
    supportsReferenceImage: false,
    // 1024², 1792×1024, 1024×1792.
    supportedAspectRatios: ["1:1", "16:9", "9:16"],
    honorsAspectRatio: true,
  },
  {
    id: "gpt-image-1",
    provider: "openai",
    kind: "image-endpoint",
    label: "GPT Image 1",
    supportsReferenceImage: false,
    // 1024², 1536×1024, 1024×1536.
    supportedAspectRatios: ["1:1", "3:2", "2:3"],
    honorsAspectRatio: true,
  },
  {
    id: "gpt-image-1-mini",
    provider: "openai",
    kind: "image-endpoint",
    label: "GPT Image 1 Mini",
    supportsReferenceImage: false,
    supportedAspectRatios: ["1:1", "3:2", "2:3"],
    honorsAspectRatio: true,
  },
  // xAI
  {
    id: "grok-2-image",
    provider: "xai",
    kind: "image-endpoint",
    label: "Grok 2 Image",
    supportsReferenceImage: false,
    // Grok image returns a fixed shape; no ratio control.
    supportedAspectRatios: ["1:1"],
    honorsAspectRatio: false,
  },
];

// Legacy → SDK id aliases. Mapped at dispatch so existing org settings
// keep working without a migration.
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

// ---------------------------------------------------------------------------
// Image aspect-ratio helpers
//
// When an AI-generated image replaces an existing one on the page, it drops
// into a slot with a fixed aspect ratio. If the generated image's shape
// differs, the browser center-crops (object-fit: cover) or overflows, which
// clips the subject. These pure helpers let the image-gen service (a) snap a
// requested ratio to the closest shape a given model supports, and (b) build
// a prompt instruction that keeps the subject inside a centered safe area and
// pads the rest, so a center crop never removes anything important.
// ---------------------------------------------------------------------------

// Parse a "w:h" ratio string into a numeric width/height ratio. Returns null
// for anything unparseable.
export function parseAspectRatio(
  input: string | undefined | null,
): number | null {
  if (!input) return null;
  const m = input.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0) || !(h > 0)) return null;
  return w / h;
}

// Snap a requested ratio to the closest value a model supports. Compared in
// log space so e.g. 2:1-vs-1:1 and 1:1-vs-1:2 are treated symmetrically.
// Falls back to "1:1" (or the first supported entry) for unparseable input.
export function snapAspectRatio(
  requested: string | undefined | null,
  supported: readonly string[],
): string {
  const pool = supported.length ? supported : ["1:1"];
  const want = parseAspectRatio(requested);
  if (want == null) return pool.includes("1:1") ? "1:1" : pool[0];
  let best = pool[0];
  let bestDelta = Infinity;
  for (const ar of pool) {
    const r = parseAspectRatio(ar);
    if (r == null) continue;
    const delta = Math.abs(Math.log(want / r));
    if (delta < bestDelta) {
      best = ar;
      bestDelta = delta;
    }
  }
  return best;
}

// Approximate output dimensions for a ratio (longer edge = 1024px). Used only
// as a pre-decode layout hint; real dimensions come from the encoded bytes.
export function aspectRatioToDims(ratio: string): {
  width: number;
  height: number;
} {
  const r = parseAspectRatio(ratio) ?? 1;
  const LONG = 1024;
  if (r >= 1) return { width: LONG, height: Math.round(LONG / r) };
  return { width: Math.round(LONG * r), height: LONG };
}

// Reduce a "w:h" ratio to a readable form (e.g. "1920:480" -> "4:1"). Decimal
// or awkwardly-large reduced terms fall back to `fallback` (the snapped clean
// ratio) so the prompt never contains something like "91:51".
export function humanizeAspectRatio(ratio: string, fallback: string): string {
  const m = ratio.trim().match(/^(\d+):(\d+)$/);
  if (!m) return fallback;
  let a = Number(m[1]);
  let b = Number(m[2]);
  if (!(a > 0) || !(b > 0)) return fallback;
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  const g = gcd(a, b);
  a /= g;
  b /= g;
  if (a > 20 || b > 20) return fallback;
  return `${a}:${b}`;
}

// Build a framing instruction to append to an image-gen prompt so the result
// fits an existing slot of `requestedRatio` without clipping the subject.
// `snappedRatio` is the closest shape the model can emit. Returns "" when
// there's no slot to match (no parseable requested ratio).
export function buildImageAspectInstruction({
  requestedRatio,
  snappedRatio,
  honorsAspectRatio,
}: {
  requestedRatio: string | undefined | null;
  snappedRatio: string;
  honorsAspectRatio: boolean;
}): string {
  const want = parseAspectRatio(requestedRatio);
  if (want == null) return "";
  const snapped = parseAspectRatio(snappedRatio) ?? want;
  // Expected distance between the model's emitted shape and the slot. For
  // models that ignore aspect-ratio hints the output is unpredictable, so we
  // always treat it as a mismatch and apply the safe-area instruction.
  const delta = honorsAspectRatio
    ? Math.abs(Math.log(snapped / want))
    : Infinity;
  // ~6%: close enough that a center crop loses nothing meaningful.
  const MATCH_THRESHOLD = 0.06;
  const ratioText = humanizeAspectRatio(
    typeof requestedRatio === "string" ? requestedRatio : "",
    snappedRatio,
  );

  if (delta < MATCH_THRESHOLD) {
    return `\n\nFraming: render the image at a ${ratioText} aspect ratio, filling the frame. Keep the main subject and any text a little inside the edges so nothing important is clipped.`;
  }

  return `\n\nFraming (important): this image will be placed into a ${ratioText} slot and center-cropped to fit — anything outside a centered ${ratioText} area is cut off. Aim to render the overall image at a ${ratioText} aspect ratio. If the composition can't naturally fill a ${ratioText} frame, keep the main subject and any text within a centered ${ratioText} region and extend the background (or add matching padding) around it, so a centered ${ratioText} crop preserves the entire subject. Don't place key content near the outer edges.`;
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
  "visual-editor-ai-figma",
  "product-analytics-chat",
  "general-chat",
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
  "visual-editor-ai-figma": "", // Always uses the default prompt set in postFigmaToVariant.ts
  "product-analytics-chat": "",
  "general-chat": "",
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
