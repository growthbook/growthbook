import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { ownerField, ownerInputField } from "./owner-field";

export const constantTypeValidator = z.enum(["string", "json"]);

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
    // Resolved per environment as `environmentValues[env] ?? defaultValue`.
    // Each value is the raw string (type "string") or JSON-encoded (type
    // "json"). At least one of the two must be set.
    defaultValue: z.string().optional(),
    environmentValues: z.record(z.string(), z.string()).optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    projects: z.array(z.string()).optional(),
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
  defaultValue: true,
  environmentValues: true,
  description: true,
  projects: true,
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
  owner: ownerInputField,
  type: constantTypeValidator,
  defaultValue: z.string().optional(),
  environmentValues: z.record(z.string(), z.string()).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  projects: z.string().array().optional(),
});

export const putConstantBodyValidator = z.object({
  name: z.string().optional(),
  owner: ownerInputField.optional(),
  defaultValue: z.string().optional(),
  environmentValues: z.record(z.string(), z.string()).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  projects: z.string().array().optional(),
  archived: z.boolean().optional(),
});
