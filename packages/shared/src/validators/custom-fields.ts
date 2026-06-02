import { z } from "zod";
import { apiBaseSchema } from "./base-model";

import { namedSchema } from "./openapi-helpers";

export const customFieldSectionValues = ["feature", "experiment"] as const;
export const customFieldSectionTypes = z.enum(customFieldSectionValues);
// All valid sections — use as the default when no section is specified.
export const ALL_SECTIONS = [...customFieldSectionValues] as const;

export const customFieldTypes = z.enum([
  "text",
  "textarea",
  "markdown",
  "enum",
  "multiselect",
  "url",
  "number",
  "boolean",
  "date",
  "datetime",
]);

export const customFieldsPropsValidator = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  defaultValue: z.any().optional(),
  type: customFieldTypes,
  values: z.string().optional(),
  required: z.boolean(),
  creator: z.string().optional(),
  projects: z.array(z.string()).optional(),
  sections: z.array(customFieldSectionTypes),
  dateCreated: z.date(),
  dateUpdated: z.date(),
  active: z.boolean().optional(),
});

export const customFieldsValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    fields: z.array(customFieldsPropsValidator),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export const redorderFieldsValidator = z
  .object({
    oldId: z.string(),
    newId: z.string(),
  })
  .strict();

export const createCustomFieldsValidator = customFieldsPropsValidator.omit({
  id: true,
  dateCreated: true,
  dateUpdated: true,
  active: true,
});

export const updateCustomFieldsValidator = customFieldsPropsValidator.omit({
  id: true,
  type: true,
  dateCreated: true,
  dateUpdated: true,
}); // `active` remains — allows enabling/disabling a field

const apiDefaultValueTypes = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.iso.datetime(),
  z.iso.date(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
  z.array(z.iso.datetime()),
  z.array(z.iso.date()),
]);

export const apiCustomFieldInterface = namedSchema(
  "CustomField",
  apiBaseSchema.safeExtend({
    name: z.string(),
    description: z.string().optional(),
    placeholder: z.string().optional(),
    defaultValue: apiDefaultValueTypes.optional(),
    type: customFieldTypes,
    values: z.string().optional(),
    required: z.boolean(),
    creator: z.string().optional(),
    projects: z.array(z.string()).optional(),
    sections: z.array(customFieldSectionTypes),
    active: z.boolean().optional(),
  }),
);

export type ApiCustomField = z.infer<typeof apiCustomFieldInterface>;

export const apiCreateCustomFieldBody = z.strictObject({
  id: z.string().min(1).describe("The unique key for the custom field"),
  name: z.string().describe("The display name of the custom field"),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  defaultValue: apiDefaultValueTypes.optional(),
  type: customFieldTypes.describe(
    "The type of value this custom field will take",
  ),
  values: z.string().optional(),
  required: z.boolean(),
  projects: z.array(z.string()).optional(),
  sections: z
    .array(customFieldSectionTypes)
    .describe(
      "What types of objects this custom field is applicable to (feature, experiment)",
    ),
});

export const apiUpdateCustomFieldBody = apiCreateCustomFieldBody
  .omit({ id: true, type: true })
  .extend({ active: z.boolean().optional() })
  .partial();
