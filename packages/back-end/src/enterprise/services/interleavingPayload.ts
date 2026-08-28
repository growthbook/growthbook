import { InterleaveExperiment } from "@growthbook/growthbook";
import { FeatureDefinition } from "shared/types/sdk";
import { SDKCapability } from "shared/sdk-versioning";
import { InterleavingInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

function isEmittable(il: InterleavingInterface, projects?: string[]): boolean {
  const projectFilter = projects && projects.length > 0 ? projects : undefined;
  return (
    il.status === "running" &&
    !il.archived &&
    (!projectFilter || !il.project || projectFilter.includes(il.project))
  );
}

/**
 * The controller feature for one interleaving experiment: a string-valued
 * feature whose value space is list names. Plain feature callers resolve the
 * `interleave` rule to the status-quo list name; the SDK interleave plugin
 * runs the draft from it. The rule payload key is capability-gated
 * ("interleaving"), so older SDKs see a rule with no force/variations, skip
 * it, and fall through to the default value.
 */
export function buildInterleaveControllerFeature(
  il: InterleavingInterface,
  options?: { includeRule?: boolean; includeRuleIds?: boolean },
): FeatureDefinition {
  const [control, treatment] = il.variationNames;
  if (options?.includeRule === false) {
    // Connection can't interleave: a rule-less feature serving the
    // status-quo list name preserves plain-caller behavior
    return { defaultValue: control };
  }
  return {
    defaultValue: control,
    rules: [
      {
        ...(options?.includeRuleIds ? { id: il.id } : {}),
        interleave: {
          lists: [control, treatment],
          fallbackValue: control,
          ...(il.measurementArmPercent
            ? { measurementArmPercent: il.measurementArmPercent }
            : {}),
        },
      },
    ],
  };
}

/**
 * Controller features for every emittable interleaving experiment, keyed by
 * tracking key. Merged into the SDK payload's features map (real features
 * with the same key win — the collision is skipped by the caller).
 */
export async function getInterleaveFeatureDefinitionsForPayload(
  context: ReqContext | ApiReqContext,
  options: {
    projects?: string[];
    capabilities?: SDKCapability[];
    includeRuleIds?: boolean;
  } = {},
): Promise<Record<string, FeatureDefinition>> {
  const { projects, capabilities, includeRuleIds } = options;
  // undefined capabilities = unrestricted (matches generateFeaturesPayload)
  const includeRule =
    capabilities === undefined || capabilities.includes("interleaving");
  const all = await context.models.interleavings.getAll();
  const out: Record<string, FeatureDefinition> = {};
  for (const il of all) {
    if (!isEmittable(il, projects)) continue;
    out[il.trackingKey] = buildInterleaveControllerFeature(il, {
      includeRule,
      includeRuleIds,
    });
  }
  return out;
}

/**
 * Build the `interleaveExperiments` section of the SDK payload: only running,
 * non-archived interleaving experiments, scoped by the payload's project list
 * (an interleaving with no project is global, matching feature semantics).
 * Lives apart from services/interleavings.ts so features.ts can import it
 * without a circular dependency.
 * @deprecated The interleave controller feature replaces this channel.
 */
export async function getInterleaveExperimentsForPayload(
  context: ReqContext | ApiReqContext,
  projects?: string[],
): Promise<InterleaveExperiment[]> {
  const all = await context.models.interleavings.getAll();
  return all
    .filter((il) => isEmittable(il, projects))
    .map((il) => ({
      key: il.trackingKey,
      lists: [il.variationNames[0], il.variationNames[1]],
      hashAttribute: "id",
      ...(il.measurementArmPercent
        ? { measurementArmPercent: il.measurementArmPercent }
        : {}),
    }));
}
