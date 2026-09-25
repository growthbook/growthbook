import {
  estimateCompletionUsd,
  findOpenRouterModel,
  openRouterIdCandidates,
  parseOpenRouterCatalog,
  type OpenRouterModel,
  type OpenRouterPricing,
} from "../src/ai-cost";

const sonnetPricing: OpenRouterPricing = {
  prompt: "0.000002",
  completion: "0.00001",
  input_cache_read: "0.0000002",
  input_cache_write: "0.0000025",
};

const geminiImagePricing: OpenRouterPricing = {
  prompt: "0.000002",
  completion: "0.000012",
  image_output: "0.00012",
  image_dimension_quality_pricing: [
    { size: "1K", cost: "0.1344" },
    { size: "2K", cost: "0.1344" },
    { size: "4K", cost: "0.24" },
    { size: "default", cost: "0.1344" },
  ],
};

describe("openRouterIdCandidates", () => {
  it("namespaces our ids with the OpenRouter author prefix", () => {
    expect(openRouterIdCandidates("claude-sonnet-5", "anthropic")).toContain(
      "anthropic/claude-sonnet-5",
    );
    expect(openRouterIdCandidates("gpt-5.6-terra", "openai")).toContain(
      "openai/gpt-5.6-terra",
    );
    expect(openRouterIdCandidates("grok-4.6", "xai")).toContain(
      "x-ai/grok-4.6",
    );
    expect(
      openRouterIdCandidates("mistral-medium-latest", "mistral"),
    ).toContain("mistralai/mistral-medium-latest");
  });

  it("adds OpenRouter's dotted and reordered aliases for dated Claude ids", () => {
    const ids = openRouterIdCandidates(
      "claude-haiku-4-5-20251001",
      "anthropic",
    );
    expect(ids).toContain("anthropic/claude-haiku-4-5-20251001");
    expect(ids).toContain("anthropic/claude-haiku-4.5");
    expect(ids).toContain("anthropic/claude-4.5-haiku-20251001");
  });

  it("maps undated Claude family ids like claude-sonnet-4-6 to dotted OpenRouter slugs", () => {
    const ids = openRouterIdCandidates("claude-sonnet-4-6", "anthropic");
    expect(ids).toContain("anthropic/claude-sonnet-4.6");
    expect(ids).toContain("anthropic/claude-4.6-sonnet");
  });
});

describe("findOpenRouterModel", () => {
  const catalog: OpenRouterModel[] = [
    {
      id: "anthropic/claude-haiku-4.5",
      canonical_slug: "anthropic/claude-haiku-4.5",
      pricing: sonnetPricing,
    },
    {
      id: "~openai/gpt-terra-latest",
      canonical_slug: "~openai/gpt-terra-latest",
      alias_target: {
        name: "OpenAI: GPT-5.6 Terra",
        slug: "openai/gpt-5.6-terra",
      },
      pricing: sonnetPricing,
    },
    {
      id: "openai/gpt-5.6-terra",
      canonical_slug: "openai/gpt-5.6-terra",
      pricing: { prompt: "0.000002", completion: "0.000012" },
    },
  ];

  it("resolves Anthropic's dated snapshot id to the canonical family row", () => {
    const hit = findOpenRouterModel(
      catalog,
      "claude-haiku-4-5-20251001",
      "anthropic",
    );
    expect(hit?.id).toBe("anthropic/claude-haiku-4.5");
  });

  it("resolves a moving alias to the pinned target for pricing", () => {
    const hit = findOpenRouterModel(catalog, "gpt-5.6-terra", "openai");
    expect(hit?.id).toBe("openai/gpt-5.6-terra");
  });

  it("returns null when nothing maps", () => {
    expect(findOpenRouterModel(catalog, "not-a-model", "openai")).toBeNull();
  });
});

describe("parseOpenRouterCatalog", () => {
  it("keeps valid rows and drops junk", () => {
    const models = parseOpenRouterCatalog({
      data: [
        { id: "anthropic/claude-sonnet-5", pricing: sonnetPricing },
        { id: 12, pricing: {} },
        { nope: true },
      ],
    });
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("anthropic/claude-sonnet-5");
  });

  it("keeps only our providers", () => {
    const models = parseOpenRouterCatalog({
      data: [
        { id: "anthropic/claude-sonnet-5", pricing: sonnetPricing },
        { id: "~openai/gpt-terra-latest", pricing: sonnetPricing },
        { id: "meta-llama/llama-3.3-70b-instruct", pricing: sonnetPricing },
      ],
    });
    expect(models.map((m) => m.id)).toEqual([
      "anthropic/claude-sonnet-5",
      "~openai/gpt-terra-latest",
    ]);
  });
});

describe("estimateCompletionUsd", () => {
  it("prices cache read cheaper than uncached input", () => {
    const uncached = estimateCompletionUsd(sonnetPricing, {
      noCacheTokens: 1_000_000,
      outputTokens: 0,
    });
    const cached = estimateCompletionUsd(sonnetPricing, {
      noCacheTokens: 0,
      cacheReadTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(uncached).toBe(2);
    expect(cached).toBe(0.2);
  });

  it("uses cache write and completion rates", () => {
    const usd = estimateCompletionUsd(sonnetPricing, {
      noCacheTokens: 1000,
      cacheWriteTokens: 1000,
      outputTokens: 1000,
    });
    // 1000*(2e-6 + 2.5e-6 + 1e-5) = 0.0145
    expect(usd).toBe(0.0145);
  });

  it("applies long-context rates only above min_prompt_tokens", () => {
    const pricing: OpenRouterPricing = {
      prompt: "0.000002",
      completion: "0.00001",
      overrides: [
        {
          min_prompt_tokens: 272000,
          prompt: "0.000004",
          completion: "0.000018",
        },
      ],
    };
    const small = estimateCompletionUsd(pricing, {
      inputTokens: 1000,
      outputTokens: 0,
    });
    const large = estimateCompletionUsd(pricing, {
      inputTokens: 272001,
      outputTokens: 0,
    });
    expect(small).toBe(0.002);
    expect(large).toBeCloseTo(272001 * 0.000004, 5);
  });

  it("does not treat min_prompt_tokens as a minimum bill", () => {
    const pricing: OpenRouterPricing = {
      prompt: "0.000002",
      completion: "0.00001",
      overrides: [{ min_prompt_tokens: 272000, prompt: "0.000004" }],
    };
    expect(
      estimateCompletionUsd(pricing, { inputTokens: 50, outputTokens: 0 }),
    ).toBe(0.0001);
  });

  it("skips overrides with unknown condition fields", () => {
    const pricing: OpenRouterPricing = {
      prompt: "0.000002",
      completion: "0.00001",
      overrides: [
        {
          min_prompt_tokens: 0,
          some_new_condition: true,
          prompt: "0.000009",
        },
      ],
    };
    expect(
      estimateCompletionUsd(pricing, { inputTokens: 1000, outputTokens: 0 }),
    ).toBe(0.002);
  });

  it("prices Gemini image output at the image rate, not text completion", () => {
    const usd = estimateCompletionUsd(geminiImagePricing, {
      inputTokens: 100,
      outputTokens: 1120,
      imageOutputCount: 1,
      imageOutputSize: "1K",
    });
    // 100 * $2/M + $0.1344/image. Do not use 1120 * $12/M (~$0.013).
    expect(usd).toBeCloseTo(0.0002 + 0.1344, 6);
    expect(usd).toBeGreaterThan(0.1);
  });

  it("uses the 4K image row when given", () => {
    const usd = estimateCompletionUsd(geminiImagePricing, {
      outputTokens: 2000,
      imageOutputCount: 1,
      imageOutputSize: "4K",
    });
    expect(usd).toBe(0.24);
  });

  it("falls back to image_output * 1120 when dimension rows are missing", () => {
    const usd = estimateCompletionUsd(
      { prompt: "0", completion: "0.000012", image_output: "0.00012" },
      { outputTokens: 1120, imageOutputCount: 1 },
    );
    expect(usd).toBeCloseTo(0.1344, 6);
  });

  it("applies time-window rates at the request instant, not fetch time", () => {
    const pricing: OpenRouterPricing = {
      prompt: "0.000002",
      completion: "0",
      overrides: [
        { utc_start: 30, utc_end: 1630, prompt: "0.000002" },
        { utc_start: 1630, utc_end: 30, prompt: "0.000004" },
      ],
    };
    const afternoon = Date.UTC(2026, 8, 18, 18, 0, 0);
    const morning = Date.UTC(2026, 8, 18, 10, 0, 0);
    expect(
      estimateCompletionUsd(
        pricing,
        { inputTokens: 1_000_000, outputTokens: 0 },
        afternoon,
      ),
    ).toBe(4);
    expect(
      estimateCompletionUsd(
        pricing,
        { inputTokens: 1_000_000, outputTokens: 0 },
        morning,
      ),
    ).toBe(2);
  });
});
