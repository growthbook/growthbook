import { includeExperimentInPayload } from "shared/util";
import { ExperimentInterface } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";

type TempRolloutExperiment = Pick<
  ExperimentInterface,
  | "id"
  | "type"
  | "status"
  | "archived"
  | "excludeFromPayload"
  | "releasedVariationId"
  | "hasVisualChangesets"
  | "hasURLRedirects"
  | "linkedFeatures"
  | "phases"
>;

function isTempRolloutCandidate(exp: TempRolloutExperiment): boolean {
  return (
    exp.status === "stopped" &&
    exp.type !== "holdout" &&
    !exp.archived &&
    !exp.excludeFromPayload &&
    !!exp.releasedVariationId
  );
}

// Linked feature ids that must be loaded to decide whether a candidate's
// rollout is really being served. Visual and redirect experiments are served
// independently of their flags, so their features are not needed.
export function getTempRolloutCandidateFeatureIds(
  experiments: TempRolloutExperiment[],
): string[] {
  const ids = new Set<string>();
  for (const exp of experiments) {
    if (!isTempRolloutCandidate(exp)) continue;
    if (exp.hasVisualChangesets || exp.hasURLRedirects) continue;
    for (const id of exp.linkedFeatures ?? []) ids.add(id);
  }
  return Array.from(ids);
}

// Stopped experiments whose temporary rollout is actually being served — the
// same check as the experiment page's "Temporary Rollout Enabled" banner.
export function selectServedTempRolloutExperimentIds(
  experiments: TempRolloutExperiment[],
  featuresById: Map<string, FeatureInterface>,
): string[] {
  const served: string[] = [];
  for (const exp of experiments) {
    if (!isTempRolloutCandidate(exp)) continue;
    const linked = (exp.linkedFeatures ?? [])
      .map((id) => featuresById.get(id))
      .filter((f): f is FeatureInterface => !!f);
    // A feature-only experiment whose linked features are all gone has
    // nothing left to serve; includeExperimentInPayload would fail open here.
    if (!exp.hasVisualChangesets && !exp.hasURLRedirects && !linked.length) {
      continue;
    }
    if (includeExperimentInPayload(exp as ExperimentInterface, linked)) {
      served.push(exp.id);
    }
  }
  return served;
}

export async function getServedTempRolloutExperimentIds(
  context: ReqContext | ApiReqContext,
  experiments: TempRolloutExperiment[],
): Promise<string[]> {
  const features = await getFeaturesByIds(
    context,
    getTempRolloutCandidateFeatureIds(experiments),
  );
  return selectServedTempRolloutExperimentIds(
    experiments,
    new Map(features.map((f) => [f.id, f])),
  );
}
