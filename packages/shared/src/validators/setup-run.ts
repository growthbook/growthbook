import { z } from "zod";
import { baseSchema, apiBaseSchema } from "./base-model";
import { namedSchema } from "./openapi-helpers";

// One pass of the SDK onboarding wizard. Deliberately holds nothing about the
// customer's codebase — no paths, no contents. Created objects are not modified to
// point back here, so `artifacts` is the only record of what a run built.

export const setupRunSources = ["cli-wizard", "skill"] as const;
export const setupRunIntents = [
  "feature-flag",
  "experiment",
  "install-only",
] as const;
export const setupRunOutcomes = ["completed", "partial", "failed"] as const;

// Closed list: the page renders per kind, and teardown needs to know the collection.
export const setupRunArtifactKinds = [
  "sdk-connection",
  "feature",
  "experiment",
  "attribute",
  "metric",
  "fact-table",
] as const;

// `by` drives the "you created this" / "we set this up for you" split on the page.
// It cannot be inferred later, so it is required.
export const setupRunArtifact = z
  .object({
    kind: z.enum(setupRunArtifactKinds),
    id: z.string().max(200).describe("Id, or key for Feature Flags"),
    label: z.string().max(200),
    by: z.enum(["developer", "growthbook"]),
    detail: z
      .string()
      .max(500)
      .nullable()
      .describe("Evidence or summary, e.g. 'boolean, off in dev'"),
    dateCreated: z.date(),
  })
  .strict();

export const setupRunCheck = z
  .object({
    name: z.string().max(100),
    ok: z.boolean(),
    required: z.boolean(),
  })
  .strict();

export const setupRunValidator = baseSchema
  .extend({
    source: z.enum(setupRunSources),
    wizardVersion: z.string().max(50).nullable(),
    agent: z.string().max(50).nullable(),

    language: z.string().max(50).nullable(),
    packageManager: z.string().max(20).nullable(),
    project: z.string().max(200).nullable(),
    environment: z.string().max(100).nullable(),

    intent: z.enum(setupRunIntents).nullable(),

    artifacts: z.array(setupRunArtifact),
    checks: z.array(setupRunCheck),

    outcome: z.enum(setupRunOutcomes).nullable(),
    failureReason: z.string().max(1000).nullable(),
    dateCompleted: z.date().nullable(),
  })
  .strict();

export type SetupRunInterface = z.infer<typeof setupRunValidator>;
export type SetupRunArtifact = z.infer<typeof setupRunArtifact>;

/* ------------------------------------------------------------------ the API */

const apiSetupRunArtifact = z
  .object({
    kind: z.enum(setupRunArtifactKinds),
    id: z.string(),
    label: z.string(),
    by: z.enum(["developer", "growthbook"]),
    detail: z.string().nullable(),
    dateCreated: z.iso.datetime(),
  })
  .strict();

export const apiSetupRunInterface = namedSchema(
  "SetupRun",
  apiBaseSchema
    .extend({
      source: z.enum(setupRunSources),
      wizardVersion: z.string().nullable(),
      agent: z.string().nullable(),
      language: z.string().nullable(),
      packageManager: z.string().nullable(),
      project: z.string().nullable(),
      environment: z.string().nullable(),
      intent: z.enum(setupRunIntents).nullable(),
      artifacts: z.array(apiSetupRunArtifact),
      checks: z.array(setupRunCheck),
      outcome: z.enum(setupRunOutcomes).nullable(),
      failureReason: z.string().nullable(),
      dateCompleted: z.iso.datetime().nullable(),
      url: z
        .string()
        .describe(
          "Absolute URL of the run's page in the app. Built server-side so callers never guess the app origin",
        ),
    })
    .strict(),
);

export type ApiSetupRun = z.infer<typeof apiSetupRunInterface>;

export const apiCreateSetupRunBody = z
  .strictObject({
    source: z.enum(setupRunSources).optional(),
    wizardVersion: z.string().max(50).optional(),
    agent: z.string().max(50).optional(),
    language: z.string().max(50).optional(),
    packageManager: z.string().max(20).optional(),
    project: z.string().max(200).optional(),
    environment: z.string().max(100).optional(),
    intent: z.enum(setupRunIntents).optional(),
  })
  .describe("Open a setup run. Everything it creates is appended afterwards");

export const apiUpdateSetupRunBody = z
  .strictObject({
    intent: z.enum(setupRunIntents).optional(),
    checks: z.array(setupRunCheck).max(50).optional(),
    outcome: z.enum(setupRunOutcomes).optional(),
    failureReason: z.string().max(1000).optional(),
  })
  .describe("Record the outcome of a setup run");

// Idempotent on (kind, id), so re-sending one that already landed is a no-op.
// That is what makes the end-of-run reconcile just a repeat of this call.
export const apiAppendSetupRunArtifactBody = setupRunArtifact
  .omit({ dateCreated: true })
  .describe("Record something the run created");
