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
// Either namespace; capture group 1 = the key. Used by the front-end linkifier,
// which routes a matched reference by its `@const:`/`@config:` prefix (the two
// namespaces are independent and a key may exist in both).
export const ANY_REF_PATTERN = "@(?:const|config):([a-z0-9][a-z0-9_-]*)";
// Namespace-capturing variant: group 1 = namespace (`const`/`config`),
// group 2 = key. Used internally to count references per namespace so a key
// shared by a constant and a config isn't conflated.
const ANY_REF_NS_PATTERN = "@(const|config):([a-z0-9][a-z0-9_-]*)";

// Backtick-escaped interpolations are emitted literally, so they're not refs.
const ESCAPED_INTERP_RE = new RegExp(
  "`\\{\\{\\s*@(?:const|config):[a-z0-9][a-z0-9_-]*\\s*\\}\\}`",
  "g",
);
// The only string position the resolver substitutes. Group 1 = namespace,
// group 2 = key.
const INTERP_REF_RE = new RegExp(
  "\\{\\{\\s*" + ANY_REF_NS_PATTERN + "\\s*\\}\\}",
  "g",
);
// A bare `@const:key`/`@config:key` placeholder, as it appears in `$extends`.
// Group 1 = namespace, group 2 = key.
const PLACEHOLDER_KEY_RE = new RegExp("^" + ANY_REF_NS_PATTERN + "$");
// A bare `@config:key` placeholder specifically (must be the first `$extends`
// entry).
const CONFIG_PLACEHOLDER_RE = new RegExp("^" + CONFIG_REF_PATTERN + "$");

const refNsToSource = (ns: string): RefSource =>
  ns === "config" ? "config" : "constant";

// Interpolation keys in a string, ignoring backtick-escaped ones. When
// `namespace` is set, only references in that namespace are collected.
function collectStringInterpRefs(
  s: string,
  into: Set<string>,
  namespace?: RefSource,
): void {
  const cleaned = s.replace(ESCAPED_INTERP_RE, "");
  const re = new RegExp(INTERP_REF_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (namespace && refNsToSource(m[1]) !== namespace) continue;
    into.add(m[2]);
  }
}

// Collect only references the resolver acts on: `@const:key`/`@config:key`
// elements of an `$extends` array and `{{ ... }}` interpolations in string
// nodes. When `namespace` is set, only references in that namespace count.
function collectJsonRefs(
  value: unknown,
  into: Set<string>,
  namespace?: RefSource,
): void {
  if (typeof value === "string") {
    collectStringInterpRefs(value, into, namespace);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectJsonRefs(v, into, namespace);
    return;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const extendsList = obj[CONSTANT_EXTENDS_KEY];
    if (Array.isArray(extendsList)) {
      for (const ref of extendsList) {
        if (typeof ref === "string") {
          const m = ref.match(PLACEHOLDER_KEY_RE);
          if (m && (!namespace || refNsToSource(m[1]) === namespace)) {
            into.add(m[2]);
          }
        } else if (ref !== null && typeof ref === "object") {
          // Inline-object `$extends` entry: scan for nested references.
          collectJsonRefs(ref, into, namespace);
        }
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      // `$extends` (when an array) is a merge directive, not a nested value.
      if (k === CONSTANT_EXTENDS_KEY && Array.isArray(extendsList)) continue;
      collectJsonRefs(v, into, namespace);
    }
  }
}

// Unique keys referenced by a value and its env overrides (the union across
// environments). Mirrors the resolver, so dead references aren't counted. When
// `namespace` is set, only `@const:` (or only `@config:`) references are
// returned, keeping the two namespaces from being conflated when a key exists
// in both. Returned keys are bare (no namespace prefix).
export function getConstantReferenceKeys(
  value: string | undefined,
  environmentValues: Record<string, string> | undefined,
  namespace?: RefSource,
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
      collectStringInterpRefs(s, keys, namespace);
      return;
    }
    collectJsonRefs(parsed, keys, namespace);
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
//
// `namespace` scopes which references count: cycles are always intra-namespace
// (a constant references only constants; a config references only configs in its
// lineage), so callers pass the entity's own namespace and a same-namespace
// `existingConstants` list. Bare keys are then unambiguous within that list.
export function getCyclicConstantRefs(
  key: string,
  proposedValue: string | undefined,
  proposedEnvironmentValues: Record<string, string> | undefined,
  existingConstants: {
    key: string;
    value?: string;
    environmentValues?: Record<string, string>;
  }[],
  namespace?: RefSource,
): string[] {
  const proposedRefs = getConstantReferenceKeys(
    proposedValue,
    proposedEnvironmentValues,
    namespace,
  );
  if (!proposedRefs.length) return [];
  const referencesByKey = new Map(
    existingConstants
      .filter((c) => c.key !== key)
      .map((c) => [
        c.key,
        getConstantReferenceKeys(c.value, c.environmentValues, namespace),
      ]),
  );
  const referencing = getReferencingConstantKeys(key, referencesByKey);
  return proposedRefs.filter((r) => r === key || referencing.has(r));
}

// What kind of resolvable owns the value being validated. Both constants and
// configs forbid a `@config:` `$extends` entry in their stored value (for
// different reasons — see the messages below); only feature values (refSource
// omitted) may carry a `@config:` ref, and only as the first entry.
export type RefSource = "constant" | "config";

// Reject `$extends` array entries that aren't a `@const:key` ref or inline
// object — the resolver silently drops them, so we catch them at save time.
//
// `onlyMergeDirectives` (feature values) limits the check to arrays that already
// look like a merge directive, so pre-existing features using `$extends` as a
// plain data key still save. Constants/configs are strict (new, no legacy data).
//
// `refSource` (when set) forbids `@config:` entries entirely, with a message
// specific to the owner. When omitted (feature values), `@config:` is allowed
// but must be the first `$extends` entry.
export function assertValidExtendsEntries(
  value: unknown,
  prefix = "",
  onlyMergeDirectives = false,
  refSource?: RefSource,
): void {
  if (Array.isArray(value)) {
    for (const v of value)
      assertValidExtendsEntries(v, prefix, onlyMergeDirectives, refSource);
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
        if (refSource && isConfigRef(entry)) {
          throw new Error(
            refSource === "config"
              ? `${prefix}A config's value cannot contain a "@config:" reference. ` +
                `Set inheritance via the config's "parent"/"extends" fields instead.`
              : `${prefix}Constants cannot reference configs. Remove the "@config:" reference.`,
          );
        }
        // For feature values (`refSource` omitted) a config is the base layer,
        // so its ref must come first.
        if (!refSource && i > 0 && isConfigRef(entry)) {
          throw new Error(
            `${prefix}A "@config:" reference must be the first "$extends" entry.`,
          );
        }
      });
    }
  } else if (CONSTANT_EXTENDS_KEY in obj) {
    // A non-array `$extends` never resolves — the resolver treats it as a plain
    // key, so a mis-wrapped ref (e.g. {"$extends": "@const:x"} instead of
    // {"$extends": ["@const:x"]}) silently ships unresolved. Reject it here: for
    // config/constant values `$extends` is a reserved directive (any non-array
    // form is wrong); for feature values, catch only the clear ref-string typo.
    const looksLikeRef =
      typeof list === "string" &&
      (PLACEHOLDER_KEY_RE.test(list) || CONFIG_PLACEHOLDER_RE.test(list));
    if (refSource || looksLikeRef) {
      throw new Error(
        `${prefix}"$extends" must be an array of "@const:key" references or inline ` +
          `objects, e.g. {"$extends": ["@const:key"]}. To use a literal key named ` +
          `"$extends", escape it with backticks: "\`$extends\`".`,
      );
    }
  }
  // Descend into own keys and inline-object `$extends` entries (via the array).
  for (const v of Object.values(obj)) {
    assertValidExtendsEntries(v, prefix, onlyMergeDirectives, refSource);
  }
}

// JSON constants must parse; an empty string is always permitted ("no value").
// Validates a constant or config value (they share a shape: a JSON object
// template with optional `$extends` refs). Pass `refSource` to forbid `@config:`
// entries in the value: constants can't embed configs, and configs express
// lineage via `parent`/`extends` (never a `@config:` in the value).
export function validateResolvableValue({
  type,
  value,
  label,
  refSource,
}: {
  type: z.infer<typeof constantTypeValidator>;
  value: string;
  label?: string;
  refSource?: RefSource;
}): void {
  const prefix = label ? `${label}: ` : "";
  if (type !== "json") {
    // Constants can't reference configs. The JSON path enforces this on
    // `$extends` entries below, but a STRING value could smuggle the same edge
    // in through a `{{ @config:key }}` interpolation the resolver would
    // happily resolve — inverting the constants ← configs dependency direction
    // with no cycle check, and invisibly to reference tracking (payload
    // refresh and publish guards never see the edge). Backtick-escaped
    // literals are exempt, matching the resolver.
    if (refSource === "constant" && value) {
      const configRefs = new Set<string>();
      collectStringInterpRefs(value, configRefs, "config");
      if (configRefs.size) {
        throw new Error(
          `${prefix}Constants cannot reference configs — remove the "{{ @config:${
            [...configRefs][0]
          } }}" interpolation. To keep it as literal text, escape it with backticks.`,
        );
      }
    }
    return;
  }
  if (value === "") return; // empty permitted
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (e) {
    throw new Error(
      `${prefix}Invalid JSON — ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // JSON values are object templates, so the value must be a plain object.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `${prefix}JSON values must be a JSON object (key/value map), not an array or primitive.`,
    );
  }
  assertValidExtendsEntries(parsed, prefix, false, refSource);
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
