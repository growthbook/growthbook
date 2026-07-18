import { isVisionCapableModel, pickVisionModel } from "../src/ai";

describe("isVisionCapableModel", () => {
  it("treats all Gemini and Claude models as vision-capable", () => {
    expect(isVisionCapableModel("gemini-2.5-pro")).toBe(true);
    expect(isVisionCapableModel("gemini-3-flash-preview")).toBe(true);
    expect(isVisionCapableModel("claude-sonnet-4-5-20250929")).toBe(true);
    expect(isVisionCapableModel("claude-3-haiku-20240307")).toBe(true);
  });

  it("treats gpt-4o / gpt-4.1 / gpt-5 as vision-capable", () => {
    expect(isVisionCapableModel("gpt-4o")).toBe(true);
    expect(isVisionCapableModel("gpt-4o-mini")).toBe(true);
    expect(isVisionCapableModel("gpt-4.1")).toBe(true);
    expect(isVisionCapableModel("gpt-5")).toBe(true);
    expect(isVisionCapableModel("gpt-5.2")).toBe(true);
  });

  it("treats reasoning o-series and non-vision models as not capable", () => {
    expect(isVisionCapableModel("o3")).toBe(false);
    expect(isVisionCapableModel("o4-mini")).toBe(false);
    expect(isVisionCapableModel("mistral-small")).toBe(false);
    expect(isVisionCapableModel("grok-3")).toBe(false);
  });

  it("handles the special-case vision models (pixtral, grok-4)", () => {
    expect(isVisionCapableModel("pixtral-12b")).toBe(true);
    expect(isVisionCapableModel("grok-4")).toBe(true);
    expect(isVisionCapableModel("grok-4-fast-reasoning")).toBe(true);
  });
});

describe("pickVisionModel", () => {
  it("keeps the configured model when it's vision-capable", () => {
    expect(
      pickVisionModel({
        visualEditorAIModel: "gpt-4o",
        openAIAPIKey: "x",
      }),
    ).toBe("gpt-4o");
  });

  it("falls back by provider key order when the configured model can't see", () => {
    expect(
      pickVisionModel({
        visualEditorAIModel: "o3",
        googleAPIKey: "g",
        openAIAPIKey: "o",
      }),
    ).toBe("gemini-2.5-pro");
    expect(
      pickVisionModel({
        visualEditorAIModel: "o3",
        openAIAPIKey: "o",
      }),
    ).toBe("gpt-4o");
    expect(
      pickVisionModel({
        visualEditorAIModel: "mistral-small",
        anthropicAPIKey: "a",
      }),
    ).toBe("claude-sonnet-4-5-20250929");
  });

  it("returns null when no vision-capable provider is available", () => {
    expect(pickVisionModel({ visualEditorAIModel: "o3" })).toBeNull();
    expect(pickVisionModel({})).toBeNull();
  });
});
