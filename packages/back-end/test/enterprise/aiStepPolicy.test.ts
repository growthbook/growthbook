import type { ModelMessage } from "ai";
import {
  FINAL_TOOL_CALL_NOTICE,
  lookupTerms,
  prepareToolStep,
  toolLoopProviderOptions,
} from "back-end/src/enterprise/services/aiStepPolicy";

const messages: ModelMessage[] = [{ role: "user", content: "swap the plans" }];

describe("toolLoopProviderOptions", () => {
  it("pins Claude to json-tool structured output", () => {
    expect(toolLoopProviderOptions("claude-sonnet-4-6")).toEqual({
      providerOptions: { anthropic: { structuredOutputMode: "jsonTool" } },
    });
  });

  it("leaves other providers alone", () => {
    expect(toolLoopProviderOptions("gpt-4.1")).toEqual({});
  });
});

describe("lookupTerms", () => {
  it("names the distinct queries and selectors a run asked for", () => {
    expect(
      lookupTerms([
        { input: '{"selector":".tab-pane-content-1"}' },
        { input: '{"query":"card-pricing_page"}' },
        { input: '{"selector":".tab-pane-content-1"}' },
        { input: '{"query":"Starter, plus"}' },
        { input: '{"query":"Contact Us"}' },
      ]),
    ).toBe("“.tab-pane-content-1”, “card-pricing_page” and “Starter, plus”");
  });

  it("copes with a single term, unparseable input, and nothing at all", () => {
    expect(
      lookupTerms([{ input: '{"query":"hero"}' }, { input: "oops" }]),
    ).toBe("“hero”");
    expect(lookupTerms([{ input: '{"prompt":"x"}' }])).toBe("");
    expect(lookupTerms([])).toBe("");
  });
});

describe("prepareToolStep", () => {
  const step = (model: "claude-sonnet-4-6" | "gpt-4.1", stepNumber: number) =>
    prepareToolStep({ model, stepNumber, remainingSteps: 3, messages });

  it("changes nothing while budget remains", () => {
    expect(step("claude-sonnet-4-6", 0)).toEqual({});
  });

  it("warns the model one step before the cap without touching the tools", () => {
    expect(step("claude-sonnet-4-6", 1)).toEqual({
      messages: [
        ...messages,
        { role: "user", content: FINAL_TOOL_CALL_NOTICE },
      ],
    });
  });

  it("empties the tool set on Claude's final step so only the json tool remains", () => {
    expect(step("claude-sonnet-4-6", 2)).toEqual({ activeTools: [] });
  });

  it("forbids tool use on other providers' final step", () => {
    expect(step("gpt-4.1", 2)).toEqual({ toolChoice: "none" });
  });

  it("forces the answer immediately when only one step is left", () => {
    expect(
      prepareToolStep({
        model: "gpt-4.1",
        stepNumber: 0,
        remainingSteps: 1,
        messages,
      }),
    ).toEqual({ toolChoice: "none" });
  });
});
