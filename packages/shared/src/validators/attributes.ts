import { z } from "zod";

import { namedSchema } from "./openapi-helpers";

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
  querySchema: z.never(),
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
