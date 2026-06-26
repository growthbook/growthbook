import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import {
  ownerField,
  ownerInputField,
  optionalOwnerInputField,
} from "./owner-field";
import { simpleSchemaValidator } from "./features";

// A JSON-object value with a field schema and `$extends` inheritance; resolves
// like a `json` constant. The schema only drives typing/validation/UX.
export const configValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    key: z.string(),
    name: z.string(),
    owner: ownerField,
    // Lineage parent (another config's `key`). `$extends` is synthesized from
    // this at resolution time, never stored in `value`.
    parent: z.string().optional(),
    // JSON-encoded object; resolved per env as `environmentValues[env] ?? value`.
    value: z.string().optional(),
    environmentValues: z.record(z.string(), z.string()).optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    archived: z.boolean().optional(),
    // Defines each field and its type for the Configuration UI.
    schema: simpleSchemaValidator.optional(),
    // Whether this config family permits extension (extra keys) by child configs,
    // feature rules, and ad-hoc overrides. Only the root config's value applies.
    // Absent = inherit the org default (`configsExtensibleByDefault`).
    extensible: z.boolean().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

// Fields revision-aware paths (revert, applyChanges) may mutate.
export const configUpdatableFieldsSchema = configValidator.pick({
  name: true,
  owner: true,
  parent: true,
  value: true,
  environmentValues: true,
  description: true,
  project: true,
  archived: true,
  schema: true,
  extensible: true,
});

const keyField = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9\-_]*$/,
    "Key must be lowercase alphanumeric with hyphens or underscores",
  );

export const postConfigBodyValidator = z.object({
  key: keyField,
  name: z.string(),
  // Optional — the controller defaults the owner to the requesting user.
  owner: optionalOwnerInputField,
  parent: z.string().optional(),
  value: z.string().optional(),
  environmentValues: z.record(z.string(), z.string()).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  project: z.string().optional(),
  schema: simpleSchemaValidator.optional(),
  extensible: z.boolean().optional(),
});

export const putConfigBodyValidator = z.object({
  name: z.string().optional(),
  owner: ownerInputField.optional(),
  parent: z.string().optional(),
  value: z.string().optional(),
  environmentValues: z.record(z.string(), z.string()).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  project: z.string().optional(),
  archived: z.boolean().optional(),
  schema: simpleSchemaValidator.optional(),
  extensible: z.boolean().optional(),
});
