import { z } from "zod";
import {
  featurePrerequisite,
  namespaceValue,
  savedGroupTargeting,
} from "./shared";
import { apiExperimentWithEnhancedStatus } from "./experiments";

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
    "Also deletes its visual changesets and removes it from presentations and its holdout. Experiment rules on linked Feature Flags are not removed.",
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
  operationId: "postExperimentRestart",
  tags: ["experiments"],
  method: "post" as const,
  path: "/experiments/:id/restart",
  possibleErrors: ["invalid_status"] as const,
};

export const postExperimentPhaseValidator = {
  bodySchema: z
    .object({
      releasePlan: z
        .enum(["new-phase", "new-phase-same-seed", "new-phase-block-sticky"])
        .optional()
        .describe(
          "`new-phase` (default) re-randomizes everyone. `new-phase-same-seed` keeps assignments. `new-phase-block-sticky` re-randomizes and also drops users sticky-bucketed in earlier phases. Bucket versions only change when sticky bucketing is on.",
        ),
      reason: z
        .string()
        .optional()
        .describe("Recorded on the phase being ended"),
      condition: z.string().optional(),
      savedGroups: z.array(savedGroupTargeting).optional(),
      prerequisites: z.array(featurePrerequisite).optional(),
      coverage: z.number().min(0).max(1).optional(),
      namespace: namespaceValue.optional(),
      variationWeights: z.array(z.number()).optional(),
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
  operationId: "deleteExperimentPhase",
  tags: ["experiments"],
  method: "delete" as const,
  path: "/experiments/:id/phases/:phase",
};
