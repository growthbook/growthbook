import { getMatchingRules, MatchingRule } from "shared/util";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  ExperimentInterface,
  ExperimentRefVariation,
  FeatureInterface,
  FeatureRule,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { applyPartialFeatureRuleUpdatesToRevision } from "back-end/src/util/featureRevision.util";
import {
  assertCanAutoPublish,
  getDraftRevision,
} from "back-end/src/services/features";

export type ExperimentFeatureUpdatePlan = {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  matchingRules: MatchingRule[];
};

export const validateExperimentFeatureUpdates = async ({
  experiment,
  features,
  linkedFeatures,
  context,
  featureRevisionOptions,
}: {
  experiment: ExperimentInterface;
  features: Record<string, ExperimentRefVariation[]>;
  featureRevisionOptions: Record<
    string,
    { targetVersion?: number; autoPublish?: boolean; forceNewDraft?: boolean }
  >;
  linkedFeatures: FeatureInterface[];
  context: ReqContext;
}): Promise<ExperimentFeatureUpdatePlan[]> => {
  const plans: ExperimentFeatureUpdatePlan[] = [];

  for (const feature of linkedFeatures) {
    const { targetVersion, autoPublish, forceNewDraft } =
      featureRevisionOptions[feature.id];

    let effectiveTargetVersion = targetVersion;

    if (forceNewDraft || autoPublish || !effectiveTargetVersion) {
      effectiveTargetVersion = feature.version;
    }

    const revision = await getDraftRevision(
      context,
      feature,
      effectiveTargetVersion,
    );
    const matchingRules = getMatchingRules(
      feature,
      (r: FeatureRule) =>
        r.type === "experiment-ref" && r.experimentId === experiment.id,
      context.environments,
      revision,
    );

    if (!matchingRules.length)
      throw new Error(
        `No experiment-ref rules found for this experiment on feature ${feature.id}`,
      );

    const updatedVariationValues = features[feature.id];
    const featureNeedsUpdate = matchingRules.some((m: MatchingRule) => {
      if (m.rule.type !== "experiment-ref") return false;
      return (
        JSON.stringify(m.rule.variations) !==
        JSON.stringify(updatedVariationValues)
      );
    });

    if (!featureNeedsUpdate) continue;

    if (autoPublish) {
      if (
        !context.permissions.canPublishFeature(
          feature,
          matchingRules.map((m) => m.environmentId),
        )
      ) {
        context.permissions.throwPermissionError();
      }

      const matches = matchingRules.map((m) => ({
        environmentId: m.environmentId,
        i: m.i,
      }));
      const projectedRevision = applyPartialFeatureRuleUpdatesToRevision(
        revision,
        matches,
        { variations: updatedVariationValues },
      );
      await assertCanAutoPublish(context, feature, projectedRevision);
    }

    plans.push({ feature, revision, matchingRules });
  }

  return plans;
};
