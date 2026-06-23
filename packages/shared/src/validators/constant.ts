import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import {
  ownerEmailField,
  ownerField,
  ownerInputField,
  optionalOwnerInputField,
} from "./owner-field";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";
import { namedSchema } from "./openapi-helpers";

export const constantTypeValidator = z.enum(["string", "json"]);

// The source of a `@const:<key>` reference (capture group 1 = the key). Exported
// so the front-end can build a fresh `RegExp` from it (e.g. to linkify
// references when displaying a value) without duplicating the pattern.
export const CONSTANT_REF_PATTERN = "@const:([a-z0-9][a-z0-9_-]*)";

const CONST_REF_RE = new RegExp(CONSTANT_REF_PATTERN, "g");

// Extract the unique `@const:` keys referenced by a constant's value and every
// environment override (the conservative union across environments). Used to
// build the cross-constant reference graph for cycle detection.
export function getConstantReferenceKeys(
  value: string | undefined,
  environmentValues: Record<string, string> | undefined,
): string[] {
  const keys = new Set<string>();
  const scan = (s: string | undefined) => {
    if (!s) return;
    const re = new RegExp(CONST_REF_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) keys.add(m[1]);
  };
  scan(value);
  for (const v of Object.values(environmentValues ?? {})) scan(v);
  return [...keys];
}

// Given the reference graph (constant key → keys it references), return every
// key that transitively references `targetKey`. Referencing any of these from
// `targetKey` would close a cycle, so they (plus `targetKey` itself) are unsafe
// to reference. Reverse-reachability BFS; cycles in the existing graph are
// handled by the visited set.
export function getReferencingConstantKeys(
  targetKey: string,
  referencesByKey: Map<string, string[]>,
): Set<string> {
  const dependents = new Map<string, string[]>();
  for (const [from, tos] of referencesByKey) {
    for (const to of tos) {
      const list = dependents.get(to);
      if (list) list.push(from);
      else dependents.set(to, [from]);
    }
  }

  const result = new Set<string>();
  const queue = [targetKey];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const dep of dependents.get(current) ?? []) {
      if (!result.has(dep)) {
        result.add(dep);
        queue.push(dep);
      }
    }
  }
  return result;
}

// Validates a constant value string before saving. JSON constants must contain
// parseable JSON; an empty string is always permitted (an intentional "no
// value"). Throws a friendly error on invalid JSON, otherwise returns nothing.
export function validateConstantValue(
  type: z.infer<typeof constantTypeValidator>,
  value: string,
  label?: string,
): void {
  if (type !== "json") return;
  if (value === "") return; // empty permitted
  try {
    JSON.parse(value);
  } catch (e) {
    const prefix = label ? `${label}: ` : "";
    throw new Error(
      `${prefix}Invalid JSON — ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// A reusable named value referenced from feature flag values. `key` is the
// stable reference handle (slugified from `name`, unique per org): string
// constants are interpolated as `{{ @const:key }}`, JSON constants substituted
// as `{ "@const:key": true }`. Resolution happens at SDK-payload build time;
// literal references are backtick-escaped.
export const constantValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    key: z.string(),
    name: z.string(),
    owner: ownerField,
    type: constantTypeValidator,
    // Resolved per environment as `environmentValues[env] ?? value`.
    // Each value is the raw string (type "string") or JSON-encoded (type
    // "json"). At least one of `value` / an environment override must be set.
    value: z.string().optional(),
    environmentValues: z.record(z.string(), z.string()).optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    // Single project (or unset = global), mirroring features so constants are a
    // drop-in for feature config (and share the feature approval scoping rules).
    project: z.string().optional(),
    archived: z.boolean().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

// Fields revision-aware code paths (revert, applyChanges) may mutate. `key`,
// `type`, `id`, `organization`, and dates are intentionally immutable — the key
// is referenced elsewhere and the type changes value semantics.
export const constantUpdatableFieldsSchema = constantValidator.pick({
  name: true,
  owner: true,
  value: true,
  environmentValues: true,
  description: true,
  project: true,
  archived: true,
});

const keyField = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9\-_]*$/,
    "Key must be lowercase alphanumeric with hyphens or underscores",
  );

export const postConstantBodyValidator = z.object({
  key: keyField,
  name: z.string(),
  // Optional — the controller defaults the owner to the requesting user.
  owner: optionalOwnerInputField,
  type: constantTypeValidator,
  value: z.string().optional(),
  environmentValues: z.record(z.string(), z.string()).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  project: z.string().optional(),
});

export const putConstantBodyValidator = z.object({
  name: z.string().optional(),
  owner: ownerInputField.optional(),
  value: z.string().optional(),
  environmentValues: z.record(z.string(), z.string()).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  project: z.string().optional(),
  archived: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// External REST API (mirrors saved groups). Validators carry the OpenAPI route
// metadata consumed by createApiRequestHandler + generate-openapi.
// ---------------------------------------------------------------------------

export const apiConstantValidator = namedSchema(
  "Constant",
  z
    .object({
      id: z.string(),
      key: z
        .string()
        .describe("Stable reference handle; used as `@const:key` in values"),
      name: z.string(),
      type: constantTypeValidator,
      owner: ownerField.optional(),
      ownerEmail: ownerEmailField,
      value: z
        .string()
        .describe(
          "The default value (raw string for `string` constants, JSON-encoded for `json` constants)",
        )
        .optional(),
      environmentValues: z
        .record(z.string(), z.string())
        .describe(
          "Per-environment value overrides (environment id → value). Falls back to `value` when an environment is absent.",
        )
        .optional(),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
      project: z
        .string()
        .describe("The project this constant belongs to (empty = all projects)")
        .optional(),
      archived: z.boolean().optional(),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

export type ApiConstant = z.infer<typeof apiConstantValidator>;

const bypassApprovalField = z
  .boolean()
  .describe(
    "Set to true to skip the approval flow when the org requires approvals for this constant's project. Requires the `bypassApprovalChecks` permission (or the org-level REST bypass setting). When approvals aren't required, this flag has no effect.",
  )
  .optional();

const postConstantApiBody = z
  .object({
    key: keyField.describe(
      "Stable reference handle (lowercase slug, unique per org), referenced as `@const:key`",
    ),
    name: z.string().describe("The display name of the constant"),
    type: constantTypeValidator.describe(
      "`string` (interpolated as `{{ @const:key }}`) or `json` (substituted as a whole value)",
    ),
    value: z.string().optional(),
    environmentValues: z.record(z.string(), z.string()).optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    owner: optionalOwnerInputField,
    bypassApproval: bypassApprovalField,
  })
  .strict();

const updateConstantApiBody = z
  .object({
    name: z.string().optional(),
    value: z.string().optional(),
    environmentValues: z.record(z.string(), z.string()).optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    owner: ownerInputField.optional(),
    bypassApproval: bypassApprovalField,
  })
  .strict();

const constantIdParams = z
  .object({ id: z.string().describe("The id of the requested resource") })
  .strict();

const apiConstantResponse = z
  .object({ constant: apiConstantValidator })
  .strict();

export const apiConstantReferencesValidator = namedSchema(
  "ConstantReferences",
  z
    .object({
      features: z.array(
        z
          .object({
            id: z.string(),
            name: z.string().optional(),
            project: z.string().optional(),
          })
          .strict(),
      ),
      constants: z.array(
        z
          .object({
            id: z.string(),
            key: z.string(),
            name: z.string(),
            project: z.string().optional(),
          })
          .strict(),
      ),
    })
    .strict(),
);

export const listConstantsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ ...paginationQueryFields }).strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({ constants: z.array(apiConstantValidator) }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all constants",
  operationId: "listConstants",
  tags: ["constants"],
  method: "get" as const,
  path: "/constants",
};

export const getConstantValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: constantIdParams,
  responseSchema: apiConstantResponse,
  summary: "Get a single constant",
  operationId: "getConstant",
  tags: ["constants"],
  method: "get" as const,
  path: "/constants/:id",
  exampleRequest: { params: { id: "const_abc123" } },
};

export const postConstantValidator = {
  bodySchema: postConstantApiBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: apiConstantResponse,
  summary: "Create a single constant",
  operationId: "postConstant",
  tags: ["constants"],
  method: "post" as const,
  path: "/constants",
  exampleRequest: {
    body: {
      key: "config-snippet",
      name: "Config Snippet",
      type: "json" as const,
      value: '{"timeout":30}',
    },
  },
};

export const updateConstantValidator = {
  bodySchema: updateConstantApiBody,
  querySchema: z.never(),
  paramsSchema: constantIdParams,
  responseSchema: apiConstantResponse,
  summary: "Partially update a single constant",
  operationId: "updateConstant",
  tags: ["constants"],
  method: "post" as const,
  path: "/constants/:id",
  exampleRequest: {
    params: { id: "const_abc123" },
    body: { value: '{"timeout":60}' },
  },
};

export const archiveConstantValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: constantIdParams,
  responseSchema: apiConstantResponse,
  summary: "Archive a single constant",
  operationId: "archiveConstant",
  tags: ["constants"],
  method: "post" as const,
  path: "/constants/:id/archive",
  exampleRequest: { params: { id: "const_abc123" } },
};

export const unarchiveConstantValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: constantIdParams,
  responseSchema: apiConstantResponse,
  summary: "Unarchive a single constant",
  operationId: "unarchiveConstant",
  tags: ["constants"],
  method: "post" as const,
  path: "/constants/:id/unarchive",
  exampleRequest: { params: { id: "const_abc123" } },
};

export const deleteConstantValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: constantIdParams,
  responseSchema: z.object({ deletedId: z.string() }).strict(),
  summary: "Delete a single constant",
  operationId: "deleteConstant",
  tags: ["constants"],
  method: "delete" as const,
  path: "/constants/:id",
  exampleRequest: { params: { id: "const_abc123" } },
};

export const getConstantReferencesValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: constantIdParams,
  responseSchema: apiConstantReferencesValidator,
  summary: "Get features and constants that reference this constant",
  operationId: "getConstantReferences",
  tags: ["constants"],
  method: "get" as const,
  path: "/constants/:id/references",
  exampleRequest: { params: { id: "const_abc123" } },
};
