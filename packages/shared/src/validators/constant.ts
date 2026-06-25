import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH, CONSTANT_EXTENDS_KEY } from "shared/constants";
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

// A backtick-wrapped string interpolation — the resolver emits these literally
// (without substituting), so the key inside is NOT a real reference. Stripped
// before reference detection so escaped literals aren't over-counted.
const ESCAPED_INTERP_RE = new RegExp(
  "`\\{\\{\\s*@const:[a-z0-9][a-z0-9_-]*\\s*\\}\\}`",
  "g",
);
// A `{{ @const:key }}` interpolation — the only string position the resolver
// substitutes. Bare `@const:key` text elsewhere in a string is NOT resolved.
const INTERP_REF_RE = new RegExp(
  "\\{\\{\\s*" + CONSTANT_REF_PATTERN + "\\s*\\}\\}",
  "g",
);
// A bare `@const:key` placeholder string, as it appears as an element of an
// `$extends` array. Anchored — the whole string must be the reference.
const PLACEHOLDER_KEY_RE = new RegExp("^" + CONSTANT_REF_PATTERN + "$");

// Collect the `{{ @const:key }}` interpolation keys from a raw string value,
// ignoring backtick-escaped ones (rendered verbatim, never resolved).
function collectStringInterpRefs(s: string, into: Set<string>): void {
  const cleaned = s.replace(ESCAPED_INTERP_RE, "");
  const re = new RegExp(INTERP_REF_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) into.add(m[1]);
}

// Walk a parsed JSON value, collecting references the resolver would actually
// act on: `@const:key` elements of an `$extends` array (object merge) and
// `{{ @const:key }}` interpolations inside any string node. Bare `@const:`
// substrings, object keys, and array entries outside `$extends` are NOT
// references (the old `key: true` notation lands here and is correctly ignored).
function collectJsonRefs(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    collectStringInterpRefs(value, into);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectJsonRefs(v, into);
    return;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const extendsList = obj[CONSTANT_EXTENDS_KEY];
    if (Array.isArray(extendsList)) {
      for (const ref of extendsList) {
        if (typeof ref === "string") {
          const m = ref.match(PLACEHOLDER_KEY_RE);
          if (m) into.add(m[1]);
        } else if (ref !== null && typeof ref === "object") {
          // Inline-object `$extends` entry (advanced): scan it for nested
          // references so cycle detection and the archive reference-block see
          // them too.
          collectJsonRefs(ref, into);
        }
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      // `$extends` (when an array) is a merge directive, not a nested value.
      if (k === CONSTANT_EXTENDS_KEY && Array.isArray(extendsList)) continue;
      collectJsonRefs(v, into);
    }
  }
}

// Extract the unique `@const:` keys referenced by a constant's value and every
// environment override (the conservative union across environments). Detection
// mirrors the resolver: only `$extends` array elements (JSON values) and
// `{{ @const:key }}` interpolations (string values) count — so dead references
// (e.g. the legacy `"@const:key": true` object-key notation, or a bare
// `@const:key` in prose) are not reported as live. Used for the reference graph
// (cycle detection) and the "what references this constant" lookups.
export function getConstantReferenceKeys(
  value: string | undefined,
  environmentValues: Record<string, string> | undefined,
): string[] {
  const keys = new Set<string>();
  const scan = (s: string | undefined) => {
    if (!s) return;
    // Cheap pre-check before the JSON.parse + recursive walk: every reference
    // (`@const:key` in `$extends`, `{{ @const:key }}` interpolation) contains
    // the literal "@const:". The overwhelming majority of feature/constant
    // values hold no reference, so this short-circuits the hot path (archive
    // checks and the cycle graph parse every value of every feature otherwise).
    if (!s.includes("@const:")) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      // Not JSON: a raw `string`-type value — only `{{ }}` interpolations count.
      collectStringInterpRefs(s, keys);
      return;
    }
    // JSON-encoded value: walk for `$extends` refs and string interpolations.
    collectJsonRefs(parsed, keys);
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

// Given a proposed value (+ env overrides) for `key`, return the referenced
// keys that would close a cycle: a self-reference, or a reference to a constant
// that already (transitively) references `key`. Empty = safe. Used to reject
// cyclic writes (the runtime resolver degrades gracefully, but a stored cycle
// leaks raw `@const:` placeholders into the payload).
export function getCyclicConstantRefs(
  key: string,
  proposedValue: string | undefined,
  proposedEnvironmentValues: Record<string, string> | undefined,
  existingConstants: {
    key: string;
    value?: string;
    environmentValues?: Record<string, string>;
  }[],
): string[] {
  const proposedRefs = getConstantReferenceKeys(
    proposedValue,
    proposedEnvironmentValues,
  );
  if (!proposedRefs.length) return [];
  const referencesByKey = new Map(
    existingConstants
      .filter((c) => c.key !== key)
      .map((c) => [
        c.key,
        getConstantReferenceKeys(c.value, c.environmentValues),
      ]),
  );
  const referencing = getReferencingConstantKeys(key, referencesByKey);
  return proposedRefs.filter((r) => r === key || referencing.has(r));
}

// Validates that every `$extends` array in a JSON value (recursively) holds only
// `@const:key` references or inline object literals — never numbers, booleans,
// null, nested arrays, or bare strings. Those are authoring mistakes the
// resolver silently drops, so we reject them at save time instead. Literal
// values belong as own keys (or an inline object), not loose `$extends` entries.
// Exported so feature JSON values can reuse the same gate.
//
// `onlyMergeDirectives` (used for feature values) restricts the check to arrays
// that are *clearly* a constant-merge directive — i.e. that already contain at
// least one `@const:` ref or inline object. A pre-existing feature whose JSON
// happened to use `$extends` as a plain data key (e.g. `{"$extends":["a","b"]}`
// or `{"$extends":[1,2]}`) is left alone so it still saves; only a malformed
// entry mixed in with real refs/objects is rejected. Constants pass the default
// (strict): they're new, `$extends` is the documented merge directive, and there
// is no legacy data to grandfather.
export function assertValidExtendsEntries(
  value: unknown,
  prefix = "",
  onlyMergeDirectives = false,
): void {
  if (Array.isArray(value)) {
    for (const v of value)
      assertValidExtendsEntries(v, prefix, onlyMergeDirectives);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  const list = obj[CONSTANT_EXTENDS_KEY];
  if (Array.isArray(list)) {
    const isRef = (e: unknown): boolean =>
      typeof e === "string" && PLACEHOLDER_KEY_RE.test(e);
    const isInlineObject = (e: unknown): boolean =>
      e !== null && typeof e === "object" && !Array.isArray(e);
    const looksLikeMergeDirective = list.some(
      (e) => isRef(e) || isInlineObject(e),
    );
    if (!onlyMergeDirectives || looksLikeMergeDirective) {
      for (const entry of list) {
        if (!isRef(entry) && !isInlineObject(entry)) {
          throw new Error(
            `${prefix}Invalid "$extends" entry ${JSON.stringify(entry)} — each ` +
              `entry must be a "@const:key" reference or an inline object. Put ` +
              `literal values as the object's own keys instead.`,
          );
        }
      }
    }
  }
  // Descend into own keys and inline-object `$extends` entries (via the array).
  for (const v of Object.values(obj)) {
    assertValidExtendsEntries(v, prefix, onlyMergeDirectives);
  }
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
  const prefix = label ? `${label}: ` : "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (e) {
    throw new Error(
      `${prefix}Invalid JSON — ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // JSON constants are key/value object templates merged via `$extends`, so the
  // value must be a plain object — arrays and primitives aren't allowed.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `${prefix}JSON constants must be a JSON object (key/value map), not an array or primitive.`,
    );
  }
  assertValidExtendsEntries(parsed, prefix);
}

// A reusable named value referenced from feature flag values. `key` is the
// stable reference handle (slugified from `name`, unique per org): string
// constants are interpolated as `{{ @const:key }}`, JSON (object) constants are
// merged via an `$extends: ["@const:key"]` array. Resolution happens at
// SDK-payload build time; literal string references are backtick-escaped.
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
    // "json"). Both are optional — a reference to a constant with no value for
    // an environment is left verbatim in the payload.
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
    environmentValues: z
      .record(z.string(), z.string())
      .describe(
        "Per-environment value overrides (environment id → value). When provided, this REPLACES the entire override map — send the complete set, not just the environments you want to change (omit the field to leave overrides unchanged).",
      )
      .optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    owner: ownerInputField.optional(),
    bypassApproval: bypassApprovalField,
  })
  .strict();

// Constants are addressed by their immutable, org-unique `key` (the same handle
// used in `@const:key` references), not their internal id.
const constantKeyParams = z
  .object({ key: z.string().describe("The key of the constant") })
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
  paramsSchema: constantKeyParams,
  responseSchema: apiConstantResponse,
  summary: "Get a single constant",
  operationId: "getConstant",
  tags: ["constants"],
  method: "get" as const,
  path: "/constants/:key",
  exampleRequest: { params: { key: "config-snippet" } },
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
  paramsSchema: constantKeyParams,
  responseSchema: apiConstantResponse,
  summary: "Partially update a single constant",
  operationId: "updateConstant",
  tags: ["constants"],
  method: "post" as const,
  path: "/constants/:key",
  exampleRequest: {
    params: { key: "config-snippet" },
    body: { value: '{"timeout":60}' },
  },
};

export const archiveConstantValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: constantKeyParams,
  responseSchema: apiConstantResponse,
  summary: "Archive a single constant",
  operationId: "archiveConstant",
  tags: ["constants"],
  method: "post" as const,
  path: "/constants/:key/archive",
  exampleRequest: { params: { key: "config-snippet" } },
};

export const unarchiveConstantValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: constantKeyParams,
  responseSchema: apiConstantResponse,
  summary: "Unarchive a single constant",
  operationId: "unarchiveConstant",
  tags: ["constants"],
  method: "post" as const,
  path: "/constants/:key/unarchive",
  exampleRequest: { params: { key: "config-snippet" } },
};

export const deleteConstantValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: constantKeyParams,
  responseSchema: z.object({ deletedId: z.string() }).strict(),
  summary: "Delete a single constant",
  operationId: "deleteConstant",
  tags: ["constants"],
  method: "delete" as const,
  path: "/constants/:key",
  exampleRequest: { params: { key: "config-snippet" } },
};

export const getConstantReferencesValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: constantKeyParams,
  responseSchema: apiConstantReferencesValidator,
  summary: "Get features and constants that reference this constant",
  operationId: "getConstantReferences",
  tags: ["constants"],
  method: "get" as const,
  path: "/constants/:key/references",
  exampleRequest: { params: { key: "config-snippet" } },
};
