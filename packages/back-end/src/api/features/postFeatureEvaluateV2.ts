import { postFeatureEvaluateValidator } from "shared/validators";
import { ArchetypeAttributeValues } from "shared/types/archetype";
import { FeatureTestResult } from "shared/types/feature";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getArchetypeById } from "back-end/src/models/ArchetypeModel";
import {
  evaluateFeature,
  filterArchetypeEnvironments,
  getFeatureEvalDependencies,
} from "back-end/src/services/features";
import { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";

function toApiEvaluation(r: FeatureTestResult) {
  const exp = r.result?.experimentResult;
  return {
    environment: r.env,
    enabled: r.enabled,
    value: r.result?.value ?? null,
    source: r.result?.source ?? null,
    ruleId: r.result?.ruleId || null,
    ...(exp
      ? {
          experiment: {
            key: exp.key,
            variationId: exp.variationId,
            inExperiment: exp.inExperiment,
            hashAttribute: exp.hashAttribute,
          },
        }
      : {}),
  };
}

async function getArchetype(context: ApiReqContext, id: string) {
  if (!context.hasPremiumFeature("archetypes")) {
    context.throwPlanDoesNotAllowError(
      "Your plan does not support archetypes.",
    );
  }
  const archetype = await getArchetypeById(id, context.org.id);
  if (
    !archetype ||
    !context.permissions.canReadMultiProjectResource(archetype.projects)
  ) {
    context.throwNotFoundError(`Archetype not found: ${id}`);
  }
  return archetype;
}

export const postFeatureEvaluateV2 = createApiRequestHandler(
  postFeatureEvaluateValidator,
)(async (req) => {
  const { context } = req;
  const feature = await getFeature(context, req.params.id);
  if (!feature)
    throw new NotFoundError("Could not find a feature with that key");

  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version: req.body.version ?? feature.version,
  });
  if (!revision) {
    throw new NotFoundError(`Revision not found: ${req.body.version}`);
  }

  const archetype = req.body.archetypeId
    ? await getArchetype(context, req.body.archetypeId)
    : null;
  const attributes: ArchetypeAttributeValues = {
    ...(archetype?.attributes ? JSON.parse(archetype.attributes) : {}),
    ...req.body.attributes,
  };

  const deps = await getFeatureEvalDependencies(context, feature);
  let environments = archetype
    ? filterArchetypeEnvironments(deps.environments, archetype)
    : deps.environments;
  if (req.body.environments) {
    const unknown = req.body.environments.filter(
      (e) => !environments.some((env) => env.id === e),
    );
    if (unknown.length) {
      context.throwBadRequestError(
        `The flag isn't evaluated in these environments: ${unknown.join(", ")}`,
      );
    }
    environments = environments.filter((e) =>
      req.body.environments?.includes(e.id),
    );
  }

  const results = evaluateFeature({
    ...deps,
    environments,
    feature,
    revision,
    attributes,
    skipRulesWithPrerequisites: req.body.skipRulesWithPrerequisites ?? true,
    date: req.body.evalDate ? new Date(req.body.evalDate) : new Date(),
  });

  return { results: results.map(toApiEvaluation) };
});
