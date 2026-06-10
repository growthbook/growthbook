import { z } from "zod";

import { namedSchema } from "./openapi-helpers";

// Accepts a valid http/https URL, or an empty string / undefined to signal
// "no URL" (used by clients to clear a previously-set value). Empty string is
// normalized to undefined so the field is removed rather than stored as "".
export const documentationUrlSchema = z.preprocess(
  (val) => (val === "" ? undefined : val),
  z
    .string()
    .url()
    .refine((val) => val.startsWith("http://") || val.startsWith("https://"), {
      message: "URL must use http or https scheme",
    })
    .optional(),
);

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
      documentationUrl: documentationUrlSchema,
      hashAttribute: z.boolean().optional(),
      archived: z.boolean().optional(),
      enum: z.string().optional(),
      format: z.enum(["", "version", "date", "isoCountryCode"]).optional(),
      projects: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    })
    .strict(),
);

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
    documentationUrl: documentationUrlSchema,
    hashAttribute: z
      .boolean()
      .describe("Shall the attribute be hashed")
      .optional(),
    enum: z.string().optional(),
    format: z
      .enum(["", "version", "date", "isoCountryCode"])
      .describe("The attribute's format")
      .optional(),
    projects: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

// Corresponds to putAttribute path requestBody
const putAttributeBody = z
  .object({
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
    documentationUrl: documentationUrlSchema,
    hashAttribute: z
      .boolean()
      .describe("Shall the attribute be hashed")
      .optional(),
    enum: z.string().optional(),
    format: z
      .enum(["", "version", "date", "isoCountryCode"])
      .describe("The attribute's format")
      .optional(),
    projects: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
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
