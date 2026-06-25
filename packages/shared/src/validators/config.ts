import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import {
  ownerField,
  ownerInputField,
  optionalOwnerInputField,
} from "./owner-field";
import { simpleSchemaValidator } from "./features";

// A Config is a JSON-object value with a field schema and inheritance support
// (`$extends`). It resolves and composes exactly like a `json` constant for
// `@const:` references — the schema only drives typing/validation/UX. Configs
// live in their own collection but share the reference/resolution machinery
// (see getConstantReferenceKeys / buildConstantValueMap), so the resolver treats
// a config as a `json` constant.
export const configValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    key: z.string(),
    name: z.string(),
    owner: ownerField,
    // Resolved per environment as `environmentValues[env] ?? value`; each is the
    // JSON-encoded object value (a config is always a JSON object).
    value: z.string().optional(),
    environmentValues: z.record(z.string(), z.string()).optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    archived: z.boolean().optional(),
    // Field schema: defines each field and its type for the Configuration UI.
    schema: simpleSchemaValidator.optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

// Fields revision-aware code paths (revert, applyChanges) may mutate. `key`,
// `id`, `organization`, and dates are immutable.
export const configUpdatableFieldsSchema = configValidator.pick({
  name: true,
  owner: true,
  value: true,
  environmentValues: true,
  description: true,
  project: true,
  archived: true,
  schema: true,
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
  value: z.string().optional(),
  environmentValues: z.record(z.string(), z.string()).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  project: z.string().optional(),
  schema: simpleSchemaValidator.optional(),
});

export const putConfigBodyValidator = z.object({
  name: z.string().optional(),
  owner: ownerInputField.optional(),
  value: z.string().optional(),
  environmentValues: z.record(z.string(), z.string()).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  project: z.string().optional(),
  archived: z.boolean().optional(),
  schema: simpleSchemaValidator.optional(),
});
