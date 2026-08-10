import { describe, it, expect } from "vitest";
import { AI_IMAGE_MODELS } from "shared/ai";
import {
  EMBEDDING_MODEL_OPTIONS,
  getAvailableAIModelOptions,
  getAvailableEmbeddingModelOptions,
  getAvailableImageModelOptions,
} from "@/services/aiModelSelectOptions";

type Option = { value: string; label: string };
type Group = { label: string; options: Option[] };

// Flatten groups; most assertions only care about the set of values.
const values = (options: (Option | Group)[]): string[] =>
  options.flatMap((o) =>
    "options" in o ? o.options.map((s) => s.value) : [o.value],
  );

const groupLabels = (options: (Option | Group)[]): string[] =>
  options.filter((o): o is Group => "options" in o).map((o) => o.label);

describe("getAvailableImageModelOptions", () => {
  it("only offers models from the given providers", () => {
    const options = getAvailableImageModelOptions(["openai"]);
    const ids = values(options).filter(Boolean);

    expect(ids.length).toBeGreaterThan(0);
    expect(
      ids.every(
        (id) => AI_IMAGE_MODELS.find((m) => m.id === id)?.provider === "openai",
      ),
    ).toBe(true);
  });

  it("does not let one provider's key unlock another's image models", () => {
    // This picker used to be a static list, unlike the other two.
    const options = getAvailableImageModelOptions(["google"]);

    expect(values(options)).not.toContain("dall-e-3");
    expect(values(options)).not.toContain("grok-2-image");
    expect(values(options)).toContain("gemini-2.5-flash-image");
  });

  it("always keeps the 'use default' entry", () => {
    expect(values(getAvailableImageModelOptions(["xai"]))).toContain("");
  });

  it("drops a group that has no models left", () => {
    // xAI ships only a text-prompt-only image model.
    expect(groupLabels(getAvailableImageModelOptions(["xai"]))).toEqual([
      "Text prompt only",
    ]);
  });

  it("keeps both groups when a provider has models in each", () => {
    expect(groupLabels(getAvailableImageModelOptions(["google"]))).toEqual([
      "Supports reference image",
      "Text prompt only",
    ]);
  });

  it("shows every model when no providers are known yet", () => {
    const ids = values(getAvailableImageModelOptions(undefined)).filter(
      Boolean,
    );

    expect(ids).toHaveLength(AI_IMAGE_MODELS.length);
  });

  it("does not expose image models for an incompatible provider list", () => {
    // Mistral serves no image models at all.
    const ids = values(getAvailableImageModelOptions(["mistral"])).filter(
      Boolean,
    );

    expect(ids).toEqual([]);
  });

  it("keeps a saved model selectable even when its provider has no key", () => {
    // Otherwise SelectField renders blank while the form still holds it.
    const options = getAvailableImageModelOptions(["google"], "dall-e-3");

    expect(values(options)).toContain("dall-e-3");
    expect(groupLabels(options)).toContain("Selected, no API key");
  });

  it("does not duplicate a saved model that is already available", () => {
    const ids = values(
      getAvailableImageModelOptions(["google"], "gemini-2.5-flash-image"),
    );

    expect(ids.filter((v) => v === "gemini-2.5-flash-image")).toHaveLength(1);
  });
});

describe("getAvailableAIModelOptions", () => {
  it("only offers models from the given providers", () => {
    const labels = groupLabels(getAvailableAIModelOptions(["anthropic"]));

    expect(labels).toEqual(["Anthropic"]);
  });

  it("keeps a saved model selectable when its provider has no key", () => {
    const options = getAvailableAIModelOptions(["anthropic"], "gpt-4o-mini");

    expect(values(options)).toContain("gpt-4o-mini");
    expect(groupLabels(options)).toContain("Selected, no API key");
  });
});

describe("getAvailableEmbeddingModelOptions", () => {
  it("only offers embedding models from the given providers", () => {
    const ids = values(getAvailableEmbeddingModelOptions(["google"]));

    expect(ids).toContain("gemini-embedding-001");
    expect(ids).not.toContain("text-embedding-3-large");
  });

  it("keeps a saved embedding model selectable", () => {
    const options = getAvailableEmbeddingModelOptions(
      ["google"],
      "mistral-embed",
    );

    expect(values(options)).toContain("mistral-embed");
  });

  it("does not expose embedding models for an incompatible provider list", () => {
    // Anthropic serves no embedding model, so only the sentinel is left.
    expect(
      values(getAvailableEmbeddingModelOptions(["anthropic"])).filter(Boolean),
    ).toEqual([]);
  });

  it("shows every embedding model while provider access is unknown", () => {
    expect(
      values(getAvailableEmbeddingModelOptions(undefined)).filter(Boolean),
    ).toHaveLength(EMBEDDING_MODEL_OPTIONS.length);
  });

  it("always keeps the 'use default' entry", () => {
    // The only way back to the default once a model has been chosen.
    expect(values(getAvailableEmbeddingModelOptions(["anthropic"]))).toContain(
      "",
    );
  });
});
