import { InterleaveExperiment } from "@growthbook/growthbook";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

/**
 * Build the `interleaveExperiments` section of the SDK payload: only running,
 * non-archived interleaving experiments, scoped by the payload's project list
 * (an interleaving with no project is global, matching feature semantics).
 * Lives apart from services/interleavings.ts so features.ts can import it
 * without a circular dependency.
 */
export async function getInterleaveExperimentsForPayload(
  context: ReqContext | ApiReqContext,
  projects?: string[],
): Promise<InterleaveExperiment[]> {
  const all = await context.models.interleavings.getAll();
  const projectFilter = projects && projects.length > 0 ? projects : undefined;
  return all
    .filter(
      (il) =>
        il.status === "running" &&
        !il.archived &&
        (!projectFilter || !il.project || projectFilter.includes(il.project)),
    )
    .map((il) => ({
      key: il.trackingKey,
      lists: [il.variationNames[0], il.variationNames[1]],
      hashAttribute: "id",
      ...(il.measurementArmPercent
        ? { measurementArmPercent: il.measurementArmPercent }
        : {}),
    }));
}
