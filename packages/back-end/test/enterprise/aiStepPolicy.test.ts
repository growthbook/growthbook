import type { ModelMessage } from "ai";
import {
  FINAL_TOOL_CALL_NOTICE,
  lookupTerms,
  prepareToolStep,
  withObjectToolInputs,
} from "back-end/src/enterprise/services/aiStepPolicy";

const messages: ModelMessage[] = [{ role: "user", content: "swap the plans" }];

describe("lookupTerms", () => {
  const find = (query: string) => ({
    tool: "findElements",
    input: JSON.stringify({ query }),
  });
  const describe_ = (selector: string) => ({
    tool: "describeContainer",
    input: JSON.stringify({ selector }),
  });

  it("names the distinct queries and selectors a run asked for", () => {
    expect(
      lookupTerms([
        describe_(".tab-pane-content-1"),
        find("card-pricing_page"),
        describe_(".tab-pane-content-1"),
        find("Starter, plus"),
        find("Contact Us"),
      ]),
    ).toBe("“.tab-pane-content-1”, “card-pricing_page” and “Starter, plus”");
  });

  it("ignores searches that aren't page lookups", () => {
    expect(
      lookupTerms([
        { tool: "searchImageLibrary", input: '{"query":"sunset hero"}' },
        { tool: "searchPastExperiments", input: '{"query":"pricing test"}' },
        find("hero"),
      ]),
    ).toBe("“hero”");
  });

  it("copes with a single term, unparseable input, and nothing at all", () => {
    expect(
      lookupTerms([find("hero"), { tool: "findElements", input: "oops" }]),
    ).toBe("“hero”");
    expect(
      lookupTerms([{ tool: "getInnerHTML", input: '{"prompt":"x"}' }]),
    ).toBe("");
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

  it("empties the tool set on Claude's final step so it must commit to structured output", () => {
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

describe("withObjectToolInputs", () => {
  const unparsed: ModelMessage[] = [
    ...messages,
    {
      role: "assistant",
      content: [
        { type: "text", text: "Let me ask." },
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "askUser",
          input: '{"question": "Which?", "options": <parameter name="id">',
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "askUser",
          output: { type: "error-text", value: "JSON parsing failed" },
        },
      ],
    },
  ];

  it("replaces an unparsed tool-call input with an empty object", () => {
    const [, assistant] = withObjectToolInputs(unparsed);
    expect(assistant.content).toEqual([
      { type: "text", text: "Let me ask." },
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "askUser",
        input: {},
      },
    ]);
  });

  it("returns the same array when every input is already an object", () => {
    expect(withObjectToolInputs(messages)).toBe(messages);
  });

  it("sends the repaired transcript on every step", () => {
    const [, assistant] = withObjectToolInputs(unparsed);
    const result = prepareToolStep({
      model: "claude-sonnet-4-6",
      stepNumber: 0,
      remainingSteps: 5,
      messages: unparsed,
    });
    expect(result.messages?.[1]).toEqual(assistant);
  });
});
