import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import {
  ownerField,
  ownerInputField,
  optionalOwnerInputField,
} from "./owner-field";

export const constantTypeValidator = z.enum(["string", "json"]);

const CONST_REF_RE = /@const:([a-z0-9][a-z0-9_-]*)/g;

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
