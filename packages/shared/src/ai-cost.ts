import { z } from "zod";

const rateSchema = z.union([z.string(), z.number()]).optional();

const imageDimensionPriceSchema = z
  .object({
    size: z.string().optional(),
    quality: z.string().optional(),
    cost: z.union([z.string(), z.number()]),
  })
  .passthrough();

export const openRouterPricingSchema = z
  .object({
    prompt: rateSchema,
    completion: rateSchema,
    request: rateSchema,
    image: rateSchema,
    image_output: rateSchema,
    web_search: rateSchema,
    internal_reasoning: rateSchema,
    input_cache_read: rateSchema,
    input_cache_write: rateSchema,
    input_cache_write_1h: rateSchema,
    overrides: z.array(z.record(z.string(), z.unknown())).optional(),
    image_dimension_quality_pricing: z
      .array(imageDimensionPriceSchema)
      .optional(),
  })
  .passthrough();

export const openRouterModelSchema = z
  .object({
    id: z.string(),
    canonical_slug: z.string().optional(),
    alias_target: z
      .object({
        name: z.string().optional(),
        slug: z.string(),
      })
      .passthrough()
      .optional(),
    pricing: openRouterPricingSchema,
  })
  .passthrough();

export const openRouterModelsResponseSchema = z.object({
  data: z.array(z.unknown()),
});

export type OpenRouterPricing = z.infer<typeof openRouterPricingSchema>;
export type OpenRouterModel = z.infer<typeof openRouterModelSchema>;

export type AICompletionUsage = {
  inputTokens?: number;
  outputTokens?: number;
  noCacheTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  imageOutputCount?: number;
  imageOutputSize?: string;
};

export const OPENROUTER_PROVIDER_PREFIX = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  xai: "x-ai",
  mistral: "mistralai",
} as const;

export type OpenRouterCatalogProvider = keyof typeof OPENROUTER_PROVIDER_PREFIX;

const KNOWN_OVERRIDE_CONDITIONS = new Set([
  "min_prompt_tokens",
  "utc_start",
  "utc_end",
  "utc_days",
]);

const OVERRIDE_PRICE_KEYS = new Set([
  "prompt",
  "completion",
  "request",
  "image",
  "image_output",
  "web_search",
  "internal_reasoning",
  "input_cache_read",
  "input_cache_write",
  "input_cache_write_1h",
  "audio",
  "audio_output",
  "image_dimension_quality_pricing",
]);

const UTC_WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export function parseUsdRate(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function openRouterIdCandidates(
  model: string,
  provider: OpenRouterCatalogProvider,
): string[] {
  const prefix = OPENROUTER_PROVIDER_PREFIX[provider];
  const ids: string[] = [];
  const add = (slug: string) => {
    const full = slug.includes("/") ? slug : `${prefix}/${slug}`;
    if (!ids.includes(full)) ids.push(full);
  };

  add(model);

  const dated = model.match(/^(claude)-([a-z0-9]+)-(\d+)-(\d+)(?:-(\d{8}))?$/i);
  if (dated) {
    const tier = dated[2];
    const major = dated[3];
    const minor = dated[4];
    const date = dated[5];
    add(`claude-${tier}-${major}.${minor}`);
    add(`claude-${major}.${minor}-${tier}`);
    add(`claude-${tier}-${major}-${minor}`);
    if (date) {
      add(`claude-${major}.${minor}-${tier}-${date}`);
      add(`claude-${tier}-${major}.${minor}-${date}`);
    }
  }

  return ids;
}

function catalogKeys(model: OpenRouterModel): string[] {
  const keys = [model.id, model.canonical_slug, model.alias_target?.slug];
  return keys.filter((k): k is string => !!k).map((k) => k.replace(/^~/, ""));
}

function isAliasRow(model: OpenRouterModel): boolean {
  return model.id.startsWith("~") || !!model.alias_target;
}

export function findOpenRouterModel(
  models: OpenRouterModel[],
  model: string,
  provider: OpenRouterCatalogProvider,
): OpenRouterModel | null {
  const byId = new Map<string, OpenRouterModel>();
  for (const entry of models) {
    for (const key of catalogKeys(entry)) {
      const existing = byId.get(key);
      if (!existing || (isAliasRow(existing) && !isAliasRow(entry))) {
        byId.set(key, entry);
      }
    }
  }

  for (const candidate of openRouterIdCandidates(model, provider)) {
    const hit = byId.get(candidate);
    if (hit) return hit;
  }

  return null;
}

const OUR_OPENROUTER_AUTHORS = new Set<string>(
  Object.values(OPENROUTER_PROVIDER_PREFIX),
);

function catalogAuthor(id: string): string {
  return id.replace(/^~/, "").split("/")[0] ?? "";
}

export function parseOpenRouterModelRows(rows: unknown): OpenRouterModel[] {
  if (!Array.isArray(rows)) return [];
  const models: OpenRouterModel[] = [];
  for (const row of rows) {
    const model = openRouterModelSchema.safeParse(row);
    if (
      model.success &&
      OUR_OPENROUTER_AUTHORS.has(catalogAuthor(model.data.id))
    ) {
      models.push(model.data);
    }
  }
  return models;
}

export function parseOpenRouterCatalog(json: unknown): OpenRouterModel[] {
  const parsed = openRouterModelsResponseSchema.safeParse(json);
  if (!parsed.success) return [];
  return parseOpenRouterModelRows(parsed.data.data);
}

function utcHhmm(nowMs: number): number {
  const d = new Date(nowMs);
  return d.getUTCHours() * 100 + d.getUTCMinutes();
}

function utcWeekday(nowMs: number): string {
  return UTC_WEEKDAYS[new Date(nowMs).getUTCDay()];
}

function utcWindowMatches(hhmm: number, start: number, end: number): boolean {
  if (end > start) return hhmm >= start && hhmm < end;
  return hhmm >= start || hhmm < end;
}

function overrideHasUnknownCondition(
  override: Record<string, unknown>,
): boolean {
  for (const key of Object.keys(override)) {
    if (KNOWN_OVERRIDE_CONDITIONS.has(key)) continue;
    if (OVERRIDE_PRICE_KEYS.has(key)) continue;
    return true;
  }
  return false;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function overrideMatches(
  override: Record<string, unknown>,
  promptTokens: number,
  nowMs: number,
): boolean {
  if (overrideHasUnknownCondition(override)) return false;

  const minPrompt = asNumber(override.min_prompt_tokens);
  if (minPrompt != null && !(promptTokens > minPrompt)) return false;

  const days = override.utc_days;
  if (Array.isArray(days) && days.length > 0) {
    const today = utcWeekday(nowMs);
    const allowed = days.map((d) => String(d).toLowerCase());
    if (!allowed.includes(today)) return false;
  }

  const start = asNumber(override.utc_start);
  const end = asNumber(override.utc_end);
  if (start != null && end != null) {
    if (!utcWindowMatches(utcHhmm(nowMs), start, end)) return false;
  } else if (start != null || end != null) {
    return false;
  }

  return true;
}

type ResolvedRates = {
  prompt: number;
  completion: number;
  request: number;
  image: number;
  imageOutput: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  imageDimensionPrices: { size?: string; quality?: string; cost: number }[];
};

function ratesFromPricing(pricing: OpenRouterPricing): ResolvedRates {
  return {
    prompt: parseUsdRate(pricing.prompt),
    completion: parseUsdRate(pricing.completion),
    request: parseUsdRate(pricing.request),
    image: parseUsdRate(pricing.image),
    imageOutput: parseUsdRate(pricing.image_output),
    cacheRead: parseUsdRate(pricing.input_cache_read),
    cacheWrite: parseUsdRate(pricing.input_cache_write),
    reasoning: parseUsdRate(pricing.internal_reasoning),
    imageDimensionPrices: (pricing.image_dimension_quality_pricing ?? []).map(
      (row) => ({
        size: row.size,
        quality: row.quality,
        cost: parseUsdRate(row.cost),
      }),
    ),
  };
}

function applyOverride(
  rates: ResolvedRates,
  override: Record<string, unknown>,
): ResolvedRates {
  const next = { ...rates };
  if ("prompt" in override) next.prompt = parseUsdRate(override.prompt);
  if ("completion" in override)
    next.completion = parseUsdRate(override.completion);
  if ("request" in override) next.request = parseUsdRate(override.request);
  if ("image" in override) next.image = parseUsdRate(override.image);
  if ("image_output" in override)
    next.imageOutput = parseUsdRate(override.image_output);
  if ("input_cache_read" in override)
    next.cacheRead = parseUsdRate(override.input_cache_read);
  if ("input_cache_write" in override)
    next.cacheWrite = parseUsdRate(override.input_cache_write);
  if ("internal_reasoning" in override)
    next.reasoning = parseUsdRate(override.internal_reasoning);
  return next;
}

export function resolveOpenRouterRates(
  pricing: OpenRouterPricing,
  promptTokens: number,
  nowMs: number = Date.now(),
): ResolvedRates {
  let rates = ratesFromPricing(pricing);
  for (const override of pricing.overrides ?? []) {
    if (!override || typeof override !== "object") continue;
    if (!overrideMatches(override, promptTokens, nowMs)) continue;
    rates = applyOverride(rates, override);
  }
  return rates;
}

function imageOutputTokensForSize(size: string | undefined): number {
  if (size?.toUpperCase() === "4K") return 2000;
  return 1120;
}

function perImageUsd(rates: ResolvedRates, size: string | undefined): number {
  const wanted = (size ?? "default").toUpperCase();
  const match = rates.imageDimensionPrices.find(
    (row) => (row.size ?? "default").toUpperCase() === wanted,
  );
  if (match) return match.cost;
  const fallback = rates.imageDimensionPrices.find(
    (row) => (row.size ?? "default").toUpperCase() === "DEFAULT",
  );
  if (fallback) return fallback.cost;
  if (rates.imageOutput > 0) {
    return rates.imageOutput * imageOutputTokensForSize(size);
  }
  return rates.image;
}

export function estimateCompletionUsd(
  pricing: OpenRouterPricing,
  usage: AICompletionUsage,
  nowMs: number = Date.now(),
): number {
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const inputTotal =
    usage.inputTokens ?? (usage.noCacheTokens ?? 0) + cacheRead + cacheWrite;
  const noCache =
    usage.noCacheTokens ??
    Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);

  const rates = resolveOpenRouterRates(pricing, inputTotal, nowMs);
  const reasoning = usage.reasoningTokens ?? 0;
  const imageCount = usage.imageOutputCount ?? 0;
  const imageTokens =
    imageCount > 0
      ? imageCount * imageOutputTokensForSize(usage.imageOutputSize)
      : 0;
  const rawOutput = usage.outputTokens ?? 0;
  const textOutput = Math.max(0, rawOutput - imageTokens - reasoning);
  const reasoningRate =
    rates.reasoning > 0 ? rates.reasoning : rates.completion;

  const usd =
    rates.request +
    noCache * rates.prompt +
    cacheRead * rates.cacheRead +
    cacheWrite * rates.cacheWrite +
    textOutput * rates.completion +
    reasoning * reasoningRate +
    (imageCount > 0
      ? imageCount * perImageUsd(rates, usage.imageOutputSize)
      : 0);

  return Math.round(usd * 1e8) / 1e8;
}
