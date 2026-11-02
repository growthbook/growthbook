import { isVisionCapableModel, pickVisionModel } from "../src/ai";

describe("isVisionCapableModel", () => {
  it("treats all Gemini and Claude models as vision-capable", () => {
    expect(isVisionCapableModel("gemini-2.5-pro")).toBe(true);
    expect(isVisionCapableModel("gemini-3-flash-preview")).toBe(true);
    expect(isVisionCapableModel("claude-fable-5-1")).toBe(true);
    expect(isVisionCapableModel("claude-haiku-5-5")).toBe(true);
  });

  it("treats gpt-4o / gpt-4.1 / gpt-5 as vision-capable", () => {
    expect(isVisionCapableModel("gpt-4o")).toBe(true);
    expect(isVisionCapableModel("gpt-4o-mini")).toBe(true);
    expect(isVisionCapableModel("gpt-4.1")).toBe(true);
    expect(isVisionCapableModel("gpt-5.4-mini")).toBe(true);
    expect(isVisionCapableModel("gpt-5.2")).toBe(true);
    expect(isVisionCapableModel("gpt-6-luna")).toBe(true);
  });

  it("treats non-vision models as not capable", () => {
    expect(isVisionCapableModel("mistral-small-latest")).toBe(false);
  });

  it("handles the special-case vision models (grok-4)", () => {
    expect(isVisionCapableModel("grok-4.7")).toBe(true);
    expect(isVisionCapableModel("grok-4.3")).toBe(true);
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
        visualEditorAIModel: "mistral-small-latest",
        googleAPIKey: "g",
        openAIAPIKey: "o",
      }),
    ).toBe("gemini-3.8-flash");
    expect(
      pickVisionModel({
        visualEditorAIModel: "mistral-small-latest",
        openAIAPIKey: "o",
      }),
    ).toBe("gpt-6.1-sol");
    expect(
      pickVisionModel({
        visualEditorAIModel: "mistral-small",
        anthropicAPIKey: "a",
      }),
    ).toBe("claude-sonnet-5-5");
  });

  it("returns null when no vision-capable provider is available", () => {
    expect(
      pickVisionModel({ visualEditorAIModel: "mistral-small-latest" }),
    ).toBeNull();
    expect(pickVisionModel({})).toBeNull();
  });
});
