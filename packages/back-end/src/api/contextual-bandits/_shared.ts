import { ContextualBanditInterface } from "shared/validators";
import {
  ContextualBanditRefRule,
  FeatureInterface,
} from "shared/types/feature";
import { ApiReqContext } from "back-end/types/api";
import { BadRequestError } from "back-end/src/util/errors";
import {
  assertValidRuleConfigKeys,
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

// Variation `config` keys go through the same relationship validation as
// every other rule/variation `config` field (existence, archived, project
// scope, flavor scoping, and membership in the feature's config family) —
// mirrors the check `putFeatureRevisionRuleV2`/`postFeatureRevisionRuleAddV2`
// run before composing a rule's config-backed value.
export async function assertValidContextualBanditVariationConfigKeys(
  context: ApiReqContext,
  feature: Pick<FeatureInterface, "defaultValue" | "baseConfig" | "project">,
  variations: VariationInput[],
): Promise<void> {
  await assertValidRuleConfigKeys(
    context,
    variations.map((v) => v.config),
    feature.defaultValue,
    feature.baseConfig,
    feature.project,
  );
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
    // TODO: remove when bandit ref rule migrates to not have
    // this field which we already ignore anyways.
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
