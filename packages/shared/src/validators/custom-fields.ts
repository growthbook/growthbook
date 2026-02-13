import { z } from "zod";
import { apiBaseSchema } from "./base-model.js";

export const customFieldSectionTypes = z.enum(["feature", "experiment"]);

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
  index: z.boolean().optional(),
  creator: z.string().optional(),
  projects: z.array(z.string()).optional(),
  section: customFieldSectionTypes,
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
  dateCreated: true,
  dateUpdated: true,
});

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

export const apiCustomFieldInterface = apiBaseSchema.safeExtend({
  name: z.string(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  defaultValue: apiDefaultValueTypes.optional(),
  type: customFieldTypes,
  values: z.string().optional(),
  required: z.boolean(),
  index: z.boolean().optional(),
  creator: z.string().optional(),
  projects: z.array(z.string()).optional(),
  section: customFieldSectionTypes,
  active: z.boolean().optional(),
});

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
  index: z.boolean().optional(),
  projects: z.array(z.string()).optional(),
  section: customFieldSectionTypes.describe(
    "What type of objects this custom field is applicable to",
  ),
});

export const apiUpdateCustomFieldBody = apiCreateCustomFieldBody
  .omit({ id: true })
  .partial();
