import { z } from "zod";
import { namedSchema } from "./openapi-helpers";

export const apiTagValidator = namedSchema(
  "Tag",
  z
    .object({
      id: z.string().describe("The tag's name."),
      color: z
        .string()
        .describe(
          "A color name such as `blue`, or a hex value. List results show tags with no color as `#029dd1`.",
        ),
      description: z.string(),
    })
    .strict(),
);

export type ApiTag = z.infer<typeof apiTagValidator>;

export const listTagsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.object({ tags: z.array(apiTagValidator) }).strict(),
  summary: "Get all tags",
  description:
    "Lists every tag in the organization in stored order. Not paginated. Any API key in the organization can read tags.",
  operationId: "listTags",
  tags: ["tags"],
  method: "get" as const,
  path: "/tags",
};

export const postTagBody = z
  .object({
    id: z.string().min(2).max(64).describe("The tag's name."),
    color: z
      .string()
      .describe(
        'A color name such as `blue`, or a hex value. Not checked. Send `""` to clear a stored color.',
      )
      .optional(),
    description: z.string().max(256).optional(),
  })
  .strict();

export type PostTagBody = z.infer<typeof postTagBody>;

export const postTagValidator = {
  bodySchema: postTagBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.object({ tag: apiTagValidator }).strict(),
  summary: "Create or update a tag",
  description:
    "Adds the tag if `id` is new, otherwise changes the existing tag. A field left out is empty on a new tag and keeps its current value on an existing one; an existing tag with no stored color gets `#029dd1`. Needs the Manage Tags permission in the organization-wide role.",
  confirmation: ["other.write"] as const,
  operationId: "postTag",
  tags: ["tags"],
  method: "post" as const,
  path: "/tags",
  exampleRequest: {
    body: {
      id: "checkout",
      color: "blue",
      description: "Anything that touches the checkout flow",
    },
  },
};
