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
export function toolLoopProviderOptions(model: AIModel) {
  if (getProviderFromModel(model) !== "anthropic") return {};
  return {
    providerOptions: {
      anthropic: { structuredOutputMode: "jsonTool" as const },
    },
  };
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
