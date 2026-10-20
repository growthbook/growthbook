import { z } from "zod";
import { readOnlyEcho } from "./shared";
import { apiExperimentWithEnhancedStatus, apiPhaseInput } from "./experiments";

const idParams = z
  .object({ id: z.string().describe("The experiment id") })
  .strict();

const experimentResponse = z
  .object({ experiment: apiExperimentWithEnhancedStatus })
  .strict();

export const deleteExperimentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z.object({ deletedId: z.string() }).strict(),
  summary: "Delete an experiment",
  description:
    "Also deletes its visual changesets and URL redirects, and removes it from presentations and its holdout. Experiment rules on linked Feature Flags are not removed.",
  // A running experiment leaves the SDK payload
  confirmation: ["experiment.delete", "experiment.stop"] as const,
  operationId: "deleteExperiment",
  tags: ["experiments"],
  method: "delete" as const,
  path: "/experiments/:id",
};

export const postExperimentRestartValidator = {
  bodySchema: z
    .object({
      status: z
        .enum(["running", "draft"])
        .optional()
        .describe("Defaults to running"),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: experimentResponse,
  summary: "Restart a stopped experiment",
  description:
    "Reopens the last phase. Bandits start a new phase with fresh buckets instead, since a bandit phase can't be resumed.",
  // A bandit restart also resets weights and bucket versions; `draft` withdraws a rollout
  confirmation: [
    "experiment.start",
    "experiment.stop",
    "experiment.traffic",
    "experiment.phases",
  ] as const,
  operationId: "postExperimentRestart",
  tags: ["experiments"],
  method: "post" as const,
  path: "/experiments/:id/restart",
  possibleErrors: ["invalid_status"] as const,
};

export const postExperimentPhaseValidator = {
  // Same targeting fields and spellings as a phase on experiment update, so a
  // phase from a GET response can be sent back with only the changes.
  bodySchema: apiPhaseInput
    .pick({
      coverage: true,
      namespace: true,
      prerequisites: true,
      condition: true,
      targetingCondition: true,
      savedGroups: true,
      savedGroupTargeting: true,
      variationWeights: true,
      trafficSplit: true,
    })
    .extend({
      releasePlan: z
        .enum(["new-phase", "new-phase-same-seed", "new-phase-block-sticky"])
        .optional()
        .describe(
          "`new-phase` (default) re-randomizes everyone. `new-phase-same-seed` keeps assignments (not allowed for bandits). `new-phase-block-sticky` re-randomizes and also drops users sticky-bucketed in earlier phases. Bucket versions only change when sticky bucketing is on.",
        ),
      reason: z
        .string()
        .optional()
        .describe("Recorded on the phase being ended"),
      name: readOnlyEcho,
      dateStarted: readOnlyEcho,
      dateEnded: readOnlyEcho,
      reasonForStopping: readOnlyEcho,
      seed: readOnlyEcho,
    })
    .strict()
    .describe(
      "Targeting fields that are omitted carry over from the current phase",
    ),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: experimentResponse,
  summary: "Start a new phase of a running experiment",
  description:
    "Ends the current phase and starts another, e.g. to change targeting or traffic and re-randomize.",
  confirmation: [
    "experiment.phases",
    "experiment.traffic",
    "experiment.targeting",
  ] as const,
  operationId: "postExperimentPhase",
  tags: ["experiments"],
  method: "post" as const,
  path: "/experiments/:id/phases",
  possibleErrors: ["invalid_status"] as const,
  exampleRequest: {
    params: { id: "exp_abc123" },
    body: { coverage: 0.5, reason: "Ramp to 50%" },
  },
};
export type PostExperimentPhaseBody = z.infer<
  typeof postExperimentPhaseValidator.bodySchema
>;

export const deleteExperimentPhaseValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z
    .object({
      id: z.string().describe("The experiment id"),
      phase: z.coerce.number().int().describe("Zero-based phase index"),
    })
    .strict(),
  responseSchema: experimentResponse,
  summary: "Delete an experiment phase",
  description:
    "Also cleans up snapshots and incremental-refresh data for the phase, which replacing `phases` on update does not. The only phase can't be deleted.",
  // Deleting the latest phase can restore an earlier one's traffic and targeting
  confirmation: [
    "experiment.phases",
    "experiment.traffic",
    "experiment.targeting",
  ] as const,
  operationId: "deleteExperimentPhase",
  tags: ["experiments"],
  method: "delete" as const,
  path: "/experiments/:id/phases/:phase",
};
