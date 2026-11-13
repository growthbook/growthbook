import { z } from "zod";
import { FEATURE_KEY_PATTERN, FEATURE_KEY_PATTERN_ERROR } from "../constants";
import { requiredUnlessPersonOwnerInputField } from "./owner-field";

export const FLAG_IMPORT_MAX_FLAGS = 200;
export const FLAG_IMPORT_MAX_RULES_PER_FLAG = 100;
export const FLAG_IMPORT_MAX_EXPERIMENTS = 100;
export const FLAG_IMPORT_MAX_BYTES = 256 * 1024;
export const FLAG_IMPORT_LIFETIME_HOURS = 24;
// Once claimed, an upload waits this long to be imported.
export const FLAG_IMPORT_CLAIMED_LIFETIME_DAYS = 7;
// Claimed uploads a workspace can hold before it has to import one.
export const FLAG_IMPORT_MAX_CLAIMED_PER_WORKSPACE = 20;

const flagsJsonCondition = z.record(z.string(), z.unknown());

const flagsJsonRange = z.tuple([z.number(), z.number()]);

// The upload is the SDK payload as JSON: what a local `flags.ts` typed as the
// SDK's FallbackPayload serializes to. Nothing here goes beyond that shape.
export const flagsJsonRule = z
  .object({
    id: z.string().optional(),
    condition: flagsJsonCondition.optional(),
    parentConditions: z
      .array(
        z
          .object({
            id: z.string(),
            condition: flagsJsonCondition,
            gate: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
    force: z.unknown().optional(),
    variations: z.array(z.unknown()).min(2).optional(),
    weights: z.array(z.number().min(0).max(1)).optional(),
    key: z.string().optional(),
    name: z.string().optional(),
    phase: z.string().optional(),
    meta: z
      .array(
        z
          .object({
            key: z.string().optional(),
            name: z.string().optional(),
            passthrough: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
    coverage: z.number().min(0).max(1).optional(),
    hashAttribute: z.string().optional(),
    fallbackAttribute: z.string().optional(),
    hashVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    seed: z.string().optional(),
    disableStickyBucketing: z.boolean().optional(),
    bucketVersion: z.number().int().min(0).optional(),
    minBucketVersion: z.number().int().min(0).optional(),
    namespace: z.tuple([z.string(), z.number(), z.number()]).optional(),
    range: flagsJsonRange.optional(),
    ranges: z.array(flagsJsonRange).optional(),
    filters: z.array(z.record(z.string(), z.unknown())).optional(),
    tracks: z.array(z.unknown()).optional(),
    contextualBanditRef: z.string().optional(),
    contextualVariations: z.array(z.unknown()).optional(),
    metadata: z.unknown().optional(),
  })
  .strict();

export const flagsJsonFeature = z
  .object({
    // Checked on the field so it is reported alongside every other problem.
    defaultValue: z
      .unknown()
      .refine((value) => value !== undefined, "defaultValue is required")
      .describe("The value when no rule matches. Any JSON value."),
    rules: z
      .array(flagsJsonRule)
      .max(FLAG_IMPORT_MAX_RULES_PER_FLAG)
      .describe("Checked in order. The first matching rule wins.")
      .optional(),
    metadata: z.unknown().optional(),
  })
  .strict();

// Visual editor and URL redirect experiments, as the SDK payload carries them.
export const flagsJsonExperiment = z.looseObject({
  key: z.string(),
  variations: z.array(z.unknown()).min(2),
  name: z.string().optional(),
});

export const flagsJsonValidator = z
  .object({
    features: z
      .record(
        z.string().regex(new RegExp(FEATURE_KEY_PATTERN)),
        flagsJsonFeature,
        {
          error: (issue) =>
            issue.code === "invalid_key"
              ? FEATURE_KEY_PATTERN_ERROR
              : undefined,
        },
      )
      .describe("Map of Feature Flag key to its definition."),
    experiments: z
      .array(flagsJsonExperiment)
      .max(FLAG_IMPORT_MAX_EXPERIMENTS)
      .optional(),
    savedGroups: z.record(z.string(), z.unknown()).optional(),
    dateUpdated: z.string().optional(),
    status: z.number().optional(),
  })
  .strict()
  .superRefine((file, ctx) => {
    const keys = Object.keys(file.features);
    if (keys.length > FLAG_IMPORT_MAX_FLAGS) {
      ctx.addIssue({
        code: "custom",
        message: `An upload can hold at most ${FLAG_IMPORT_MAX_FLAGS} Feature Flags`,
        path: ["features"],
      });
    }
    if (!keys.length && !file.experiments?.length) {
      ctx.addIssue({
        code: "custom",
        message: "The upload has no Feature Flags",
        path: ["features"],
      });
    }
  });

export type FlagsJson = z.infer<typeof flagsJsonValidator>;
export type FlagsJsonFeature = z.infer<typeof flagsJsonFeature>;
export type FlagsJsonRule = z.infer<typeof flagsJsonRule>;

export const flagImportValueTypes = [
  "boolean",
  "string",
  "number",
  "json",
] as const;

export const flagImportSummary = z
  .object({
    flags: z.number(),
    rules: z.number(),
    experiments: z.number(),
    environments: z
      .array(z.string())
      .describe("The `env` values the rules target."),
    attributes: z.array(z.string()),
  })
  .strict();

export const flagImportWarning = z
  .object({ path: z.string(), message: z.string() })
  .strict();

export const flagImportFlag = z
  .object({
    key: z.string(),
    valueType: z.enum(flagImportValueTypes),
    rules: z.number(),
    experiments: z.number(),
    importable: z.boolean(),
    reason: z
      .string()
      .nullable()
      .describe("Why the Feature Flag will not be imported, when it will not."),
  })
  .strict();

export const flagImportResult = z
  .object({
    kind: z.enum(["feature", "experiment", "environment", "attribute"]),
    key: z.string(),
    status: z.enum(["created", "exists", "skipped", "failed"]),
    message: z.string().nullable(),
  })
  .strict();

export const flagImportStatuses = ["pending", "claimed", "imported"] as const;

// What anyone holding the link can see: nothing from the upload, and nothing
// about the workspace that took it.
export const apiFlagImportStatus = z
  .object({
    status: z.enum(flagImportStatuses),
    expiresAt: z.string(),
  })
  .strict();

// What the workspace that claimed it can see.
export const apiFlagImport = z
  .object({
    status: z.enum(flagImportStatuses),
    name: z.string().nullable(),
    agent: z.string().nullable(),
    dateCreated: z.string(),
    expiresAt: z.string(),
    file: flagsJsonValidator
      .nullable()
      .describe("The uploaded flags. Null once they have been imported."),
    existingFlags: z
      .array(z.string())
      .describe("Keys in the upload that this workspace already has."),
    imported: z
      .object({
        at: z.string(),
        results: z.array(flagImportResult),
        autoRunUrl: z
          .string()
          .nullable()
          .describe("The report page for this import."),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const flagImportRuleFix = z.union([
  z.object({ remove: z.literal(true) }).strict(),
  z
    .object({ environments: z.array(z.string().min(1)).min(1).max(50) })
    .strict(),
]);

export const flagImportChoices = z
  .object({
    flags: z
      .array(z.string())
      .max(FLAG_IMPORT_MAX_FLAGS)
      .describe(
        "Keys of the Feature Flags to import. Leave out to import every one that can be.",
      )
      .optional(),
    environments: z
      .record(z.string(), z.string().min(1))
      .describe(
        "Maps an environment named in the upload to the workspace environment to use in its place.",
      )
      .optional(),
    rules: z
      .record(z.string(), z.record(z.string(), flagImportRuleFix))
      .describe(
        "Fixes for rules that cannot be imported as written, keyed by Feature Flag key and then by the rule's position in the upload, starting at 0. A fix either removes the rule or sets the environments it applies to.",
      )
      .optional(),
  })
  .strict();

export type FlagImportSummary = z.infer<typeof flagImportSummary>;
export type FlagImportWarning = z.infer<typeof flagImportWarning>;
export type FlagImportFlag = z.infer<typeof flagImportFlag>;
export type FlagImportResult = z.infer<typeof flagImportResult>;
export type FlagImportStatus = (typeof flagImportStatuses)[number];
export type ApiFlagImportStatus = z.infer<typeof apiFlagImportStatus>;
export type ApiFlagImport = z.infer<typeof apiFlagImport>;
export type FlagImportChoices = z.infer<typeof flagImportChoices>;

const tokenParams = z
  .object({
    token: z.string().describe("The token from the end of the claim link."),
  })
  .strict();

export const postFlagImportValidator = {
  bodySchema: flagsJsonValidator,
  querySchema: z
    .object({
      name: z
        .string()
        .max(100)
        .describe("The app or repository name, shown on the claim page.")
        .optional(),
      agent: z
        .string()
        .max(100)
        .describe("The coding agent sending the flags, e.g. claude-code.")
        .optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      token: z.string(),
      claimUrl: z
        .string()
        .describe("Give this link to the person who will own the flags."),
      expiresAt: z.string(),
      summary: flagImportSummary,
      warnings: z.array(flagImportWarning),
      howToUse: z.string(),
    })
    .strict(),
  summary: "Upload flags defined in code for someone to claim, with no account",
  description:
    "Send the SDK payload as JSON in the request body. For flags kept in a local `flags.ts`, that is `JSON.stringify(flags)`. The upload is checked and kept for 24 hours, and the response has a claim link. Whoever opens the link signs up or signs in, claims the upload for their workspace and chooses what to import. No API key is needed. A top-level `env` in a rule's condition becomes the environments that rule applies to. A rule with `variations` becomes a draft experiment linked to its Feature Flag.",
  operationId: "postFlagImport",
  tags: ["flag-imports"],
  method: "post" as const,
  path: "/flag-imports",
  confirmation: [] as const,
  confirmationInHandler: true,
  unauthenticated: true,
  exampleRequest: {
    body: {
      features: {
        newCheckout: {
          defaultValue: false,
          rules: [
            { condition: { env: { $in: ["dev", "staging"] } }, force: true },
            { force: true, coverage: 0.2, hashAttribute: "id" },
          ],
        },
      },
    },
  },
};

export const getFlagImportValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: tokenParams,
  responseSchema: z.object({ flagImport: apiFlagImportStatus }).strict(),
  summary: "Check whether uploaded flags have been claimed or imported",
  description:
    "The token is the only credential, and the answer says nothing about what was uploaded or what was created: only whether it is pending, claimed or imported.",
  operationId: "getFlagImport",
  tags: ["flag-imports"],
  method: "get" as const,
  path: "/flag-imports/:token",
  unauthenticated: true,
};

export const postFlagImportClaimValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: tokenParams,
  responseSchema: z.object({ flagImport: apiFlagImport }).strict(),
  summary: "Claim uploaded flags for your workspace",
  description:
    "Ties the upload to the caller's workspace and returns it. Nothing is created. One workspace can claim an upload, and it then has 7 days to import it. Calling this again from the same workspace returns the upload.",
  operationId: "postFlagImportClaim",
  tags: ["flag-imports"],
  method: "post" as const,
  path: "/flag-imports/:token/claim",
  confirmation: [] as const,
  confirmationInHandler: true,
};

export const getFlagImportDetailsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: tokenParams,
  responseSchema: z.object({ flagImport: apiFlagImport }).strict(),
  summary: "Get uploaded flags your workspace has claimed",
  description:
    "Returns the upload to the workspace that claimed it, with the keys it already has. Any other workspace gets a 403.",
  operationId: "getFlagImportDetails",
  tags: ["flag-imports"],
  method: "get" as const,
  path: "/flag-imports/:token/details",
};

export const postFlagImportImportValidator = {
  bodySchema: flagImportChoices
    .extend({
      project: z
        .string()
        .describe("ID of the Project to create the Feature Flags in.")
        .optional(),
      owner: requiredUnlessPersonOwnerInputField,
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: tokenParams,
  responseSchema: z.object({ flagImport: apiFlagImport }).strict(),
  summary: "Import claimed flags into your workspace",
  description:
    "Creates each chosen Feature Flag with the caller's own permissions, the same way `POST /v2/features` does, and records the import as an Auto Run. A Feature Flag whose key already exists is skipped, never overwritten. An upload can be imported once. An API key that needs a person's confirmation for these writes is refused: open the claim link instead.",
  operationId: "postFlagImportImport",
  tags: ["flag-imports"],
  method: "post" as const,
  path: "/flag-imports/:token/import",
  confirmation: [] as const,
  confirmationInHandler: true,
};
