import isEqual from "lodash/isEqual";
import { includeExperimentInPayload } from "shared/util";
import type { ExperimentInterface } from "shared/types/experiment";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import {
  getHoldoutLivePayloadChanges,
  isHoldoutExperiment,
} from "back-end/src/services/holdouts";
import { BadRequestError } from "back-end/src/util/errors";

export type LivePayloadInput = {
  variations?: { id: string; key: string }[];
  coverage?: number;
  variationWeights?: number[];
  // The results page reconciles keys against exposure data; that edit is
  // allowed while running.
  isVariationKeyReconciliation?: boolean;
};

// Which of an experiment update's fields would alter what the SDK serves for
// a running experiment: the variation ids and keys, coverage, and weights of
// the latest phase.
export function getLivePayloadChanges(
  experiment: ExperimentInterface,
  input: LivePayloadInput,
): { changesLivePayload: boolean; changedFields: string[] } {
  if (isHoldoutExperiment(experiment)) {
    return getHoldoutLivePayloadChanges(experiment, input.coverage);
  }
  const latestPhase = experiment.phases[experiment.phases.length - 1];
  const existingKeyById = new Map(
    experiment.variations.map((v) => [v.id, v.key]),
  );
  const variationIdsChanged =
    !!input.variations &&
    !isEqual(
      input.variations.map((v) => v.id),
      latestPhase?.variations.map((v) => v.id),
    );
  const variationKeysChanged =
    !!input.variations &&
    input.variations.some((v) => v.key !== existingKeyById.get(v.id));
  const coverageChanged =
    input.coverage !== undefined && input.coverage !== latestPhase?.coverage;
  const variationWeightsChanged =
    input.variationWeights !== undefined &&
    !isEqual(input.variationWeights, latestPhase?.variationWeights);

  const changedFields = [
    variationIdsChanged && "variation IDs",
    variationKeysChanged && "variation keys",
    coverageChanged && "coverage",
    variationWeightsChanged && "variationWeights",
  ].filter((f): f is string => !!f);

  return {
    changedFields,
    changesLivePayload:
      variationIdsChanged ||
      (variationKeysChanged && !input.isVariationKeyReconciliation) ||
      coverageChanged ||
      variationWeightsChanged,
  };
}

// A running experiment that is live in the SDK payload cannot have those
// fields changed in place; linked feature rules would keep the old variation
// ids and serve null for the arms they no longer match.
export async function assertLivePayloadChangeAllowed(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  input: LivePayloadInput,
): Promise<void> {
  if (experiment.status !== "running") return;
  const { changesLivePayload, changedFields } = getLivePayloadChanges(
    experiment,
    input,
  );
  if (!changesLivePayload) return;
  const linkedFeatures = await getFeaturesByIds(
    context,
    experiment.linkedFeatures || [],
  );
  if (includeExperimentInPayload(experiment, linkedFeatures)) {
    throw new BadRequestError(
      `Cannot change: [${changedFields.join(", ")}] while the experiment is running and live in the SDK payload.`,
    );
  }
}
