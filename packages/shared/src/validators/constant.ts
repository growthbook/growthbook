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

// A raw `string` (interpolated as `{{ @const:key }}`) or a `json` object (merged
// via `$extends`). Configs are separate but resolve like `json` constants.
export const constantTypeValidator = z.enum(["string", "json"]);

// Capture group 1 = the key. Constant-only; exported so the front-end can build
// its own RegExp for constant references.
export const CONSTANT_REF_PATTERN = "@const:([a-z0-9][a-z0-9_-]*)";
// Config-only counterpart (`@config:key`), for the front-end config linkifier.
export const CONFIG_REF_PATTERN = "@config:([a-z0-9][a-z0-9_-]*)";
// Either namespace; capture group 1 = the key. Used wherever the reference is
// counted/linkified regardless of namespace (cycle detection and the key space
// are shared, so keys are globally unique).
export const ANY_REF_PATTERN = "@(?:const|config):([a-z0-9][a-z0-9_-]*)";

// Backtick-escaped interpolations are emitted literally, so they're not refs.
const ESCAPED_INTERP_RE = new RegExp(
  "`\\{\\{\\s*@(?:const|config):[a-z0-9][a-z0-9_-]*\\s*\\}\\}`",
  "g",
);
// The only string position the resolver substitutes.
const INTERP_REF_RE = new RegExp(
  "\\{\\{\\s*" + ANY_REF_PATTERN + "\\s*\\}\\}",
  "g",
);
// A bare `@const:key`/`@config:key` placeholder, as it appears in `$extends`.
const PLACEHOLDER_KEY_RE = new RegExp("^" + ANY_REF_PATTERN + "$");
// A bare `@config:key` placeholder specifically (must be the first `$extends`
// entry).
const CONFIG_PLACEHOLDER_RE = new RegExp("^" + CONFIG_REF_PATTERN + "$");

// Interpolation keys in a string, ignoring backtick-escaped ones.
function collectStringInterpRefs(s: string, into: Set<string>): void {
  const cleaned = s.replace(ESCAPED_INTERP_RE, "");
  const re = new RegExp(INTERP_REF_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) into.add(m[1]);
}

// Collect only references the resolver acts on: `@const:key` elements of an
// `$extends` array and `{{ @const:key }}` interpolations in string nodes.
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
          // Inline-object `$extends` entry: scan for nested references.
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

// Unique `@const:` keys referenced by a value and its env overrides (the union
// across environments). Mirrors the resolver, so dead references aren't counted.
export function getConstantReferenceKeys(
  value: string | undefined,
  environmentValues: Record<string, string> | undefined,
): string[] {
  const keys = new Set<string>();
  const scan = (s: string | undefined) => {
    if (!s) return;
    // Cheap pre-check: every reference contains "@const:"/"@config:", and most
    // values hold none, so this short-circuits the JSON.parse + walk.
    if (!s.includes("@const:") && !s.includes("@config:")) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      // Not JSON: a raw string value — only `{{ }}` interpolations count.
      collectStringInterpRefs(s, keys);
      return;
    }
    collectJsonRefs(parsed, keys);
  };
  scan(value);
  for (const v of Object.values(environmentValues ?? {})) scan(v);
  return [...keys];
}

// Every key that transitively references `targetKey` (reverse-reachability BFS).
// Referencing any of them from `targetKey` would close a cycle.
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

// The proposed refs for `key` that would close a cycle (self-reference or a
// constant that already transitively references `key`). Empty = safe.
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

// Reject `$extends` array entries that aren't a `@const:key` ref or inline
// object — the resolver silently drops them, so we catch them at save time.
//
// `onlyMergeDirectives` (feature values) limits the check to arrays that already
// look like a merge directive, so pre-existing features using `$extends` as a
// plain data key still save. Constants are strict (new, no legacy data).
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
    const isConfigRef = (e: unknown): boolean =>
      typeof e === "string" && CONFIG_PLACEHOLDER_RE.test(e);
    const isInlineObject = (e: unknown): boolean =>
      e !== null && typeof e === "object" && !Array.isArray(e);
    const looksLikeMergeDirective = list.some(
      (e) => isRef(e) || isInlineObject(e),
    );
    if (!onlyMergeDirectives || looksLikeMergeDirective) {
      list.forEach((entry, i) => {
        if (!isRef(entry) && !isInlineObject(entry)) {
          throw new Error(
            `${prefix}Invalid "$extends" entry ${JSON.stringify(entry)} — each ` +
              `entry must be a "@const:key" reference or an inline object. Put ` +
              `literal values as the object's own keys instead.`,
          );
        }
        // A config is always the base layer, so its ref must come first.
        if (i > 0 && isConfigRef(entry)) {
          throw new Error(
            `${prefix}A "@config:" reference must be the first "$extends" entry.`,
          );
        }
      });
    }
  }
  // Descend into own keys and inline-object `$extends` entries (via the array).
  for (const v of Object.values(obj)) {
    assertValidExtendsEntries(v, prefix, onlyMergeDirectives);
  }
}

// JSON constants must parse; an empty string is always permitted ("no value").
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
  // JSON constants are object templates, so the value must be a plain object.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `${prefix}JSON constants must be a JSON object (key/value map), not an array or primitive.`,
    );
  }
  assertValidExtendsEntries(parsed, prefix);
}

// A reusable named value referenced from feature values via `@const:key`,
// resolved at SDK-payload build time. `key` is the stable handle, unique per org.
export const constantValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    key: z.string(),
    name: z.string(),
    owner: ownerField,
    type: constantTypeValidator,
    // Resolved per environment as `environmentValues[env] ?? value`.
    value: z.string().optional(),
    environmentValues: z.record(z.string(), z.string()).optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    // Single project (or unset = global), mirroring features.
    project: z.string().optional(),
    archived: z.boolean().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

// Fields revision-aware paths may mutate; key/type/id/dates are immutable.
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

// External REST API. Validators carry the OpenAPI route metadata.
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

// Addressed by `key`, not internal id.
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
