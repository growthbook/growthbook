import type { ApiReqContext } from "back-end/types/api";

export function rejectAiForCb(context: ApiReqContext): never {
  context.throwBadRequestError(
    "AI-assisted visual editor features are not yet supported for contextual bandits.",
  );
  throw new Error("unreachable");
}

export function rejectVariantChangeForCb(context: ApiReqContext): never {
  context.throwBadRequestError(
    "Variation changes for contextual bandits go through the contextual bandit variations modal in GrowthBook.",
  );
  throw new Error("unreachable");
}

export function rejectFigmaForCb(context: ApiReqContext): never {
  context.throwBadRequestError(
    "Figma-assisted visual editor features are not yet supported for contextual bandits.",
  );
  throw new Error("unreachable");
}
