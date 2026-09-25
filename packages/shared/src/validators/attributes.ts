import { z } from "zod";

import { namedSchema } from "./openapi-helpers";

const enumFieldDescription =
  "Comma-separated list of allowed values. Required for the 'enum' datatype. " +
  "For array datatypes (string[], number[], secureString[]) it optionally " +
  "restricts the list to these values. Ignored for all other datatypes.";

// Corresponds to schemas/Attribute.yaml
export const apiAttributeValidator = namedSchema(
  "Attribute",
  z
    .object({
      property: z.string(),
      datatype: z.enum([
        "boolean",
        "string",
        "number",
        "secureString",
        "enum",
        "string[]",
        "number[]",
        "secureString[]",
      ]),
      description: z.string().optional(),
      hashAttribute: z.boolean().optional(),
      archived: z.boolean().optional(),
      enum: z.string().describe(enumFieldDescription).optional(),
      format: z.enum(["", "version", "date", "isoCountryCode"]).optional(),
      projects: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      disableEqualityConditions: z.boolean().optional(),
    })
    .strict(),
);

const disableEqualityConditionsField = z
  .boolean()
  .describe(
    "Prevent exact-match targeting on this attribute; only regex and greater/less than comparisons are allowed. Useful for PII.",
  )
  .optional();

// Corresponds to postAttribute path requestBody
const postAttributeBody = z
  .object({
    property: z.string().describe("The attribute property"),
    datatype: z
      .enum([
        "boolean",
        "string",
        "number",
        "secureString",
        "enum",
        "string[]",
        "number[]",
        "secureString[]",
      ])
      .describe("The attribute datatype"),
    description: z
      .string()
      .describe("The description of the new attribute")
      .optional(),
    archived: z.boolean().describe("The attribute is archived").optional(),
    hashAttribute: z
      .boolean()
      .describe("Shall the attribute be hashed")
      .optional(),
    enum: z.string().describe(enumFieldDescription).optional(),
    format: z
      .enum(["", "version", "date", "isoCountryCode"])
      .describe("The attribute's format")
      .optional(),
    projects: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    disableEqualityConditions: disableEqualityConditionsField,
  })
  .strict();

// Corresponds to putAttribute path requestBody
const putAttributeBody = z
  .object({
    property: z
      .string()
      .describe(
        "Rename the attribute. Conditions that reference the old name are not updated; check `getAttributeReferences` first.",
      )
      .optional(),
    datatype: z
      .enum([
        "boolean",
        "string",
        "number",
        "secureString",
        "enum",
        "string[]",
        "number[]",
        "secureString[]",
      ])
      .describe("The attribute datatype")
      .optional(),
    description: z
      .string()
      .describe("The description of the new attribute")
      .optional(),
    archived: z.boolean().describe("The attribute is archived").optional(),
    hashAttribute: z
      .boolean()
      .describe("Shall the attribute be hashed")
      .optional(),
    enum: z.string().describe(enumFieldDescription).optional(),
    format: z
      .enum(["", "version", "date", "isoCountryCode"])
      .describe("The attribute's format")
      .optional(),
    projects: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    disableEqualityConditions: disableEqualityConditionsField,
  })
  .strict();

const propertyParams = z
  .object({
    property: z.string().describe("The attribute property"),
  })
  .strict();

export const listAttributesValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      projectId: z
        .string()
        .optional()
        .describe(
          "Filter to attributes available in this project — includes org-wide attributes (no project restriction) and attributes explicitly scoped to this project.",
        ),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      attributes: z.array(apiAttributeValidator),
    })
    .strict(),
  summary: "Get the organization's attributes",
  operationId: "listAttributes",
  tags: ["attributes"],
  method: "get" as const,
  path: "/attributes",
};

export const postAttributeValidator = {
  bodySchema: postAttributeBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      attribute: apiAttributeValidator,
    })
    .strict(),
  summary: "Create a new attribute",
  operationId: "postAttribute",
  tags: ["attributes"],
  method: "post" as const,
  path: "/attributes",
  exampleRequest: {
    body: {
      property: "foo",
      datatype: "boolean",
      description: "My new attribute",
    },
  } as const,
};

export const putAttributeValidator = {
  bodySchema: putAttributeBody,
  querySchema: z.never(),
  paramsSchema: propertyParams,
  responseSchema: z
    .object({
      attribute: apiAttributeValidator,
    })
    .strict(),
  summary: "Update an attribute",
  operationId: "putAttribute",
  tags: ["attributes"],
  method: "put" as const,
  path: "/attributes/:property",
  exampleRequest: {
    params: { property: "abc123" },
    body: { description: "My updated attribute" },
  } as const,
};

export const getAttributeReferencesValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: propertyParams,
  responseSchema: z
    .object({
      features: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          project: z.string().optional(),
        }),
      ),
      experiments: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          project: z.string().optional(),
          projects: z.array(z.string()).optional(),
        }),
      ),
      savedGroups: z.array(
        z.object({
          id: z.string(),
          groupName: z.string(),
          projects: z.array(z.string()).optional(),
        }),
      ),
    })
    .strict(),
  summary: "Get what references an attribute",
  description:
    "Feature Flag rules, experiments (targeting or hash attribute) and condition Saved Groups that use the attribute. Check this before renaming or deleting it.",
  operationId: "getAttributeReferences",
  tags: ["attributes"],
  method: "get" as const,
  path: "/attributes/:property/references",
};

export const deleteAttributeValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: propertyParams,
  responseSchema: z
    .object({
      deletedProperty: z.string(),
    })
    .strict(),
  summary: "Deletes a single attribute",
  operationId: "deleteAttribute",
  tags: ["attributes"],
  method: "delete" as const,
  path: "/attributes/:property",
  exampleRequest: { params: { property: "abc123" } },
};
