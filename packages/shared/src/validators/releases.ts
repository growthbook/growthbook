import { z } from "zod";
import { namedSchema } from "./openapi-helpers";

// Releases — the REST namespace for coordinated multi-entity publishing. The
// bare `POST /releases` slot stays free for a future full Release entity.

const entityTypeField = z.enum([
  "feature",
  "saved-group",
  "config",
  "constant",
]);

// An item names its revision by identifier + version, or by revision id —
// strict unions, so the two forms can't be mixed within one item.
const revisionIdField = z
  .string()
  .describe(
    "A revision id from this API or the revision webhooks (`rev_…` / `frev_…`). Alternative to identifier + version.",
  );

export const publishRevisionsItem = z.union([
  namedSchema(
    "FeatureRevisionRef",
    z
      .object({
        entityType: z.literal("feature"),
        id: z.string().describe("Feature Flag id."),
        version: z.number().int().describe("Revision version to publish."),
      })
      .strict(),
  ),
  namedSchema(
    "SavedGroupRevisionRef",
    z
      .object({
        entityType: z.literal("saved-group"),
        id: z.string().describe("Saved Group id."),
        version: z.number().int().describe("Revision version to publish."),
      })
      .strict(),
  ),
  namedSchema(
    "ConfigRevisionRef",
    z
      .object({
        entityType: z.literal("config"),
        key: z.string().describe("Config key."),
        version: z.number().int().describe("Revision version to publish."),
      })
      .strict(),
  ),
  namedSchema(
    "ConstantRevisionRef",
    z
      .object({
        entityType: z.literal("constant"),
        key: z.string().describe("Constant key."),
        version: z.number().int().describe("Revision version to publish."),
      })
      .strict(),
  ),
  namedSchema(
    "RevisionIdRef",
    z
      .object({
        entityType: entityTypeField,
        revisionId: revisionIdField,
      })
      .strict(),
  ),
]);

const publishRevisionsGate = z.object({
  entityType: entityTypeField,
  id: z.string().describe("The identifier used in the request."),
  version: z.number().int(),
  type: z.string().describe('Gate kind, e.g. "approval-required".'),
  severity: z.enum(["blocker", "warning"]),
  messages: z.array(z.string()),
  override: z
    .string()
    .nullable()
    .describe("Request flag that clears this gate on retry, if any."),
  requiresPermission: z.string().nullable(),
  resolution: z
    .object({
      action: z.string(),
      method: z.string(),
      path: z.string(),
    })
    .nullable()
    .describe("A route that resolves the gate without an override flag."),
});

const publishRevisionsResultItem = z.object({
  entityType: entityTypeField,
  id: z.string().describe("The identifier used in the request."),
  version: z.number().int(),
  revisionId: z.string().describe("The revision's id (`rev_…` or `frev_…`)."),
  status: z.enum(["published", "would-publish"]),
});

const publishRevisionsBypassedGate = z.object({
  entityType: entityTypeField,
  id: z.string(),
  version: z.number().int(),
  type: z.string(),
  via: z
    .string()
    .describe(
      "What bypassed the gate: an override flag, the bypass-approval permission, or the REST-bypass org setting.",
    ),
});

export const postReleasePublishRevisionsValidator = {
  method: "post" as const,
  path: "/releases/publish-revisions",
  operationId: "postReleasePublishRevisions",
  summary: "Atomically publish revisions across multiple entities",
  description:
    "Publishes a set of revisions — at most one per entity — across Feature Flags, Saved Groups, configs, and constants as a single all-or-nothing operation.\n\n" +
    "Validation, guards, and custom hooks run against the combined end-state of the whole set, so interdependent changes (e.g. a config schema change plus the values that depend on it) publish together even when the in-between states would be invalid.\n\n" +
    "A blocked publish returns one 422 listing every gate across every item and the flag that clears each. A concurrent change to any target aborts with a 409 and nothing publishes. A failure after the commit starts rolls everything back and emits `revision.publishFailed` for each revision in the set. SDK payloads refresh once per request. Pass `dryRun: true` for the full gate report with zero writes.\n\n" +
    "Requires the `releases` commercial feature.",
  tags: ["releases"],
  paramsSchema: z.never(),
  querySchema: z.never(),
  bodySchema: z
    .object({
      revisions: z
        .array(publishRevisionsItem)
        .min(1)
        .max(50)
        .describe("The revisions to publish, at most one per entity."),
      dryRun: z
        .boolean()
        .optional()
        .describe("Report every gate and outcome without writing anything."),
      ignoreWarnings: z
        .boolean()
        .optional()
        .describe(
          "Acknowledge warning-class gates: experiment guards, schema-break and archive warnings, stale-base force-merge (needs the bypass-approval permission).",
        ),
      skipSchemaValidation: z
        .boolean()
        .optional()
        .describe(
          "Force past schema and invariant failures. Only honored with the `bypassApprovalChecks` permission; validation still runs and is reported.",
        ),
      skipHooks: z
        .boolean()
        .optional()
        .describe(
          "Force past custom validation-hook rejections. Only honored with the `bypassApprovalChecks` permission.",
        ),
      comment: z
        .string()
        .optional()
        .describe(
          "An optional publish comment recorded on every revision in this release — it appears in each entity's revision history and is passed to any custom validation hooks that run for the publish.",
        ),
    })
    .strict(),
  responseSchema: z.object({
    dryRun: z.boolean(),
    bulkPublishId: z
      .string()
      .optional()
      .describe(
        "Correlation token (`pub_…`) stamped on every event this publish emitted. Absent on dry runs.",
      ),
    results: z.array(publishRevisionsResultItem),
    gates: z
      .array(publishRevisionsGate)
      .describe(
        "Dry runs report every gate, cleared and blocking. Real publishes return an empty list — blocking gates fail with a 422 instead.",
      ),
    bypassedGates: z
      .array(publishRevisionsBypassedGate)
      .describe(
        "Gates bypassed by the caller's flags or authority — what this publish overrode.",
      ),
    warnings: z.array(z.string()),
  }),
  version: "v2" as const,
};
