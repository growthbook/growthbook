import { ContextualBanditInterface } from "shared/validators";
import { ContextualBanditRefRule } from "shared/types/feature";
import { ApiReqContext } from "back-end/types/api";
import { BadRequestError } from "back-end/src/util/errors";
import {
  composeConfigBacking,
  resolveProjectScopeFromInput,
  resolveScopeFromInput,
} from "back-end/src/api/features/v2Shared";

export async function loadContextualBanditForRead(
  context: ApiReqContext,
  id: string,
): Promise<{ contextualBandit: ContextualBanditInterface }> {
  if (!context.hasPremiumFeature("contextual-bandits")) {
    context.throwPlanDoesNotAllowError(
      "Contextual Bandits require an Enterprise plan.",
    );
  }
  const contextualBandit = await context.models.contextualBandits.getById(id);
  if (!contextualBandit) {
    return context.throwNotFoundError();
  }
  if (
    !context.permissions.canReadSingleProjectResource(contextualBandit.project)
  ) {
    context.permissions.throwPermissionError();
  }
  return { contextualBandit };
}

type VariationInput = {
  variationId: string;
  value: string;
  config?: string | null;
};

/**
 * The bandit serves every arm, so a rule that only defines some of them would
 * emit nulls into the SDK payload. The UI seeds the full set from the bandit;
 * API callers get an explicit error instead.
 */
export function assertVariationsCoverBandit(
  contextualBandit: ContextualBanditInterface,
  variations: VariationInput[],
): void {
  const banditIds = contextualBandit.variations.map((v) => v.id);
  const seen = new Set<string>();

  for (const v of variations) {
    if (!banditIds.includes(v.variationId)) {
      throw new BadRequestError(
        `Unknown variation id "${v.variationId}" for contextual bandit ${contextualBandit.id}.`,
      );
    }
    if (seen.has(v.variationId)) {
      throw new BadRequestError(
        `Variation id "${v.variationId}" is listed more than once.`,
      );
    }
    seen.add(v.variationId);
  }

  const missing = banditIds.filter((id) => !seen.has(id));
  if (missing.length) {
    throw new BadRequestError(
      `Missing a value for contextual bandit variation(s): ${missing.join(", ")}.`,
    );
  }
}

export function buildContextualBanditRefRule(
  contextualBandit: ContextualBanditInterface,
  body: {
    variations: VariationInput[];
    description?: string;
    enabled?: boolean;
    allEnvironments?: boolean;
    environments?: string[];
    allProjects?: boolean;
    projects?: string[];
  },
): ContextualBanditRefRule {
  const scope = resolveScopeFromInput(body.allEnvironments, body.environments);
  const projectScope = resolveProjectScopeFromInput(
    body.allProjects,
    body.projects,
  );

  return {
    type: "contextual-bandit-ref",
    id: "",
    contextualBanditId: contextualBandit.id,
    description: body.description ?? "",
    enabled: body.enabled ?? true,
    // Targeting is inherited from the bandit, so these stay empty.
    condition: "",
    scheduleRules: [],
    allEnvironments: scope.allEnvironments,
    ...(scope.environments !== undefined && {
      environments: scope.environments,
    }),
    allProjects: projectScope.allProjects,
    ...(projectScope.projects !== undefined && {
      projects: projectScope.projects,
    }),
    variations: body.variations.map((v) => ({
      variationId: v.variationId,
      value:
        v.config !== undefined
          ? composeConfigBacking(v.config, v.value, "Variation value")
          : v.value,
    })),
  };
}
