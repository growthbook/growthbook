import type { ModelMessage } from "ai";
import { type AIModel, getProviderFromModel } from "shared/ai";

// Provider options for a multi-step tool loop that must end in structured
// output. The AI SDK's Anthropic provider turns `toolChoice: "none"` into
// "send no tools at all", and in its json-tool mode — which it uses for every
// Claude model it doesn't recognise, i.e. all the current ones — it ignores
// the caller's toolChoice entirely, so the final-step guard below never
// reached the model (observed: 14/14 steps ending on a lookup tool). Pinning
// that mode makes the answer a forced call to the provider's own `json` tool,
// which `activeTools: []` on the final step leaves as the only tool to call.
// That mode forces a tool call on every step, which the API rejects alongside
// extended thinking — don't enable Anthropic `thinking` for these loops.
export function toolLoopProviderOptions(model: AIModel) {
  if (getProviderFromModel(model) !== "anthropic") return {};
  return {
    providerOptions: {
      anthropic: { structuredOutputMode: "jsonTool" as const },
    },
  };
}

// The tools that look things up ON THE PAGE. Only their arguments describe
// an element the user could click; an image-library or past-experiment
// search in the same trace does not.
const PAGE_LOOKUP_TOOLS: ReadonlySet<string> = new Set([
  "findElements",
  "describeContainer",
  "getInnerHTML",
  "getComputedStyles",
]);

// The distinct things a run's page-lookup tools were asked for, as prose — so
// the error a user sees after a lookup loop names what the AI was hunting
// for, which is the element they should click.
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

// prepareStep policy for a loop capped at `remainingSteps`: warn one step
// before the cap so the model spends its last lookup well, then take the
// tools away on the final step so the run ends in the structured output
// instead of on a dangling tool call (NoOutputGeneratedError).
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
