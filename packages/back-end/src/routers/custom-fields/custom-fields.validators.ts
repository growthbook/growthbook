import { z } from "zod";

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
