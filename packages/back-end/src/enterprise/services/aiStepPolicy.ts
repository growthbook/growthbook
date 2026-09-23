import type { ModelMessage } from "ai";
import { type AIModel, getProviderFromModel } from "shared/ai";

// Anthropic json-tool mode ignores toolChoice, so the final step empties activeTools instead. No `thinking`.
export function toolLoopProviderOptions(model: AIModel) {
  if (getProviderFromModel(model) !== "anthropic") return {};
  return {
    providerOptions: {
      anthropic: { structuredOutputMode: "jsonTool" as const },
    },
  };
}

// Page-lookup tools: only their arguments name an element the user could click.
const PAGE_LOOKUP_TOOLS: ReadonlySet<string> = new Set([
  "findElements",
  "describeContainer",
  "getInnerHTML",
  "getComputedStyles",
]);

// What the page lookups were asked for, so the error names the element to click.
export function lookupTerms(
  trace: ReadonlyArray<{ tool: string; input: string }>,
  max = 3,
): string {
  const terms: string[] = [];
  for (const { tool, input } of trace) {
    if (!PAGE_LOOKUP_TOOLS.has(tool)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const { query, selector } = parsed as {
      query?: unknown;
      selector?: unknown;
    };
    const term = [query, selector].find(
      (v): v is string => typeof v === "string" && v.trim().length > 0,
    );
    if (term && !terms.includes(term.trim())) terms.push(term.trim());
  }
  const shown = terms.slice(0, max).map((t) => `“${t}”`);
  if (shown.length === 0) return "";
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

export const FINAL_TOOL_CALL_NOTICE =
  "You have one tool call left. After it, reply with the final structured output built from what you already have — complete every part you can, and say what you could not resolve rather than looking further.";

export interface PrepareToolStepInput {
  model: AIModel;
  stepNumber: number;
  remainingSteps: number;
  messages: ModelMessage[];
}

// Warn one step before the cap, then take the tools away so the run ends in the structured output.
export function prepareToolStep({
  model,
  stepNumber,
  remainingSteps,
  messages,
}: PrepareToolStepInput): {
  toolChoice?: "none";
  activeTools?: [];
  messages?: ModelMessage[];
} {
  const last = Math.max(0, remainingSteps - 1);
  if (stepNumber >= last) {
    return getProviderFromModel(model) === "anthropic"
      ? { activeTools: [] }
      : { toolChoice: "none" };
  }
  if (stepNumber === last - 1) {
    return {
      messages: [
        ...messages,
        { role: "user", content: FINAL_TOOL_CALL_NOTICE },
      ],
    };
  }
  return {};
}
