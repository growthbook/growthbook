import { z } from "zod";
import { baseSchema, apiBaseSchema } from "./base-model";
import { namedSchema } from "./openapi-helpers";

// One pass of the SDK onboarding wizard. Deliberately holds nothing about the
// customer's codebase — no file contents, and paths only where they are shown back
// to the user as evidence for a claim. Created objects are not modified to point
// back here, so `artifacts` is the only record of what a run built.

export const setupRunSources = ["cli-wizard", "skill"] as const;
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

// Flat scalars, deliberately. Everything the wizard learns about the machine it ran
// on lives here instead of being its own field: the package manager, the versions,
// the framework. That keeps adding one a CLI change rather than a change to the
// validator, the API body, the model defaults and the API mapper.
//
// Flat rather than nested JSON so a value stays indexable as `metadata.language`,
// renderable without recursion, and bounded — the writer is a CLI in a loop.
const metadataValue = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.null(),
]);
export const setupRunMetadata = z.record(z.string().max(60), metadataValue);

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

// The arrays are embedded, which is right — a run is read whole and an idempotent
// append is one document update. They are capped because an unbounded array inside
// a document is a 16MB ceiling nobody is watching, and the writer is a loop.
export const setupRunValidator = baseSchema
  .extend({
    source: z.enum(setupRunSources),
    agent: z.string().max(50).nullable(),
    createdBy: z.string().max(100).nullable(),

    metadata: setupRunMetadata,

    artifacts: z.array(setupRunArtifact).max(200),
    checks: z.array(setupRunCheck).max(50),

    outcome: z.enum(setupRunOutcomes).nullable(),
    failureReason: z.string().max(1000).nullable(),
    dateCompleted: z.date().nullable(),
  })
  .strict();

export type SetupRunInterface = z.infer<typeof setupRunValidator>;
export type SetupRunArtifact = z.infer<typeof setupRunArtifact>;
export type SetupRunMetadata = z.infer<typeof setupRunMetadata>;

// Metadata is open, so a caller can put a number where a reader wants a string.
// Reading through this keeps that from reaching the UI as "42" or worse.
export function setupRunMetaString(
  metadata: SetupRunMetadata,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value !== "" ? value : null;
}

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
      agent: z.string().nullable(),
      createdBy: z
        .string()
        .nullable()
        .describe("Id of the user who ran the wizard"),
      metadata: setupRunMetadata.describe(
        "What the wizard learned about the environment it ran in — language, packageManager, framework, versions. Open by design; do not rely on any single key being present",
      ),
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
    agent: z.string().max(50).optional(),
    metadata: setupRunMetadata.optional(),
  })
  .describe("Open a setup run. Everything it creates is appended afterwards");

// `metadata` replaces rather than merges. The client accumulates it locally over the
// run and sends the whole record, the same way artifacts are reconciled at the end,
// so there is one owner of it per run. Sending a partial record here drops the rest.
export const apiUpdateSetupRunBody = z
  .strictObject({
    metadata: setupRunMetadata.optional(),
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
