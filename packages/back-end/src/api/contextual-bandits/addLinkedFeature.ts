import {
  addContextualBanditLinkedFeatureValidator,
  ContextualBanditInterface,
} from "shared/validators";
import { ContextualBanditRefRule } from "shared/types/feature";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError } from "back-end/src/util/errors";
import { getFeature } from "back-end/src/models/FeatureModel";
import { linkFeatureToContextualBandit } from "back-end/src/enterprise/services/contextualBandits";
import {
  composeConfigBacking,
  resolveProjectScopeFromInput,
  resolveScopeFromInput,
} from "back-end/src/api/features/v2Shared";
import { loadContextualBanditForRead } from "./_shared";

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
function assertVariationsCoverBandit(
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

export const addContextualBanditLinkedFeature = createApiRequestHandler(
  addContextualBanditLinkedFeatureValidator,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );

  if (
    !req.context.permissions.canUpdateContextualBandit(contextualBandit, {})
  ) {
    req.context.permissions.throwPermissionError();
  }

  const feature = await getFeature(req.context, req.params.featureId);
  if (!feature) {
    return req.context.throwNotFoundError(
      `Could not find a Feature Flag with id ${req.params.featureId}`,
    );
  }

  if (contextualBandit.linkedFeatures?.includes(feature.id)) {
    throw new BadRequestError(
      `Feature Flag ${feature.id} is already linked to this contextual bandit.`,
    );
  }

  const {
    variations,
    description,
    enabled,
    allEnvironments,
    environments,
    allProjects,
    projects,
    autoPublish,
    draftVersion,
  } = req.body;

  assertVariationsCoverBandit(contextualBandit, variations);

  const scope = resolveScopeFromInput(allEnvironments, environments);
  const projectScope = resolveProjectScopeFromInput(allProjects, projects);

  const rule: ContextualBanditRefRule = {
    type: "contextual-bandit-ref",
    id: "",
    contextualBanditId: contextualBandit.id,
    description: description ?? "",
    enabled: enabled ?? true,
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
    variations: variations.map((v) => ({
      variationId: v.variationId,
      value:
        v.config !== undefined
          ? composeConfigBacking(v.config, v.value, "Variation value")
          : v.value,
    })),
  };

  const result = await linkFeatureToContextualBandit({
    context: req.context,
    contextualBandit,
    feature,
    rule,
    eventAudit: req.eventAudit,
    audit: req.audit,
    autoPublish,
    draftVersion,
    forceNewDraft: draftVersion === undefined,
  });

  return {
    featureId: feature.id,
    ruleId: result.ruleId,
    revisionVersion: result.version,
    published: result.published,
  };
});
