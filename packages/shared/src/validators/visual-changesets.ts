import { z } from "zod";
import { apiExperimentValidator } from "./experiments";

import { namedSchema } from "./openapi-helpers";

// Corresponds to schemas/VisualChange.yaml
export const apiVisualChangeValidator = namedSchema(
  "VisualChange",
  z
    .object({
      description: z.string().optional(),
      css: z.string().optional(),
      js: z.string().optional(),
      variation: z.string(),
      domMutations: z
        .array(
          z.object({
            selector: z.string(),
            action: z.enum(["append", "set", "remove"]),
            attribute: z.string(),
            value: z.string().optional(),
            parentSelector: z.string().optional(),
            insertBeforeSelector: z.string().optional(),
          }),
        )
        .optional(),
    })
    .strict(),
);

// Corresponds to schemas/VisualChangeset.yaml
export const apiVisualChangesetValidator = namedSchema(
  "VisualChangeset",
  z
    .object({
      id: z.string().optional(),
      urlPatterns: z.array(
        z.object({
          include: z.boolean().optional(),
          type: z.enum(["simple", "regex"]),
          pattern: z.string(),
        }),
      ),
      editorUrl: z.string(),
      experiment: z.string(),
      visualChanges: z.array(
        z.object({
          description: z.string().optional(),
          css: z.string().optional(),
          js: z.string().optional(),
          variation: z.string(),
          domMutations: z.array(
            z.object({
              selector: z.string(),
              action: z.enum(["append", "set", "remove"]),
              attribute: z.string(),
              value: z.string().optional(),
              parentSelector: z.string().optional(),
              insertBeforeSelector: z.string().optional(),
            }),
          ),
        }),
      ),
    })
    .strict(),
);

export type ApiVisualChangeset = z.infer<typeof apiVisualChangesetValidator>;

// Corresponds to payload-schemas/PostExperimentVisualChangesetPayload.yaml
const postVisualChangesetBody = z
  .object({
    editorUrl: z
      .string()
      .describe(
        "URL of the page opened in the visual editor when creating this changeset",
      ),
    urlPatterns: z
      .array(
        z.object({
          include: z.boolean().optional(),
          type: z.enum(["simple", "regex"]),
          pattern: z.string(),
        }),
      )
      .describe(
        "URL patterns that determine which pages this visual changeset applies to",
      ),
  })
  .strict();

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listVisualChangesetsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z
    .object({
      id: z
        .string()
        .describe("The experiment id the visual changesets belong to"),
    })
    .strict(),
  responseSchema: z
    .object({
      visualChangesets: z.array(apiVisualChangesetValidator),
    })
    .strict(),
  summary: "Get all visual changesets",
  operationId: "listVisualChangesets",
  tags: ["visual-changesets"],
  method: "get" as const,
  path: "/experiments/:id/visual-changesets",
  exampleRequest: { params: { id: "abc123" } },
};

export const postVisualChangesetsValidator = {
  bodySchema: postVisualChangesetBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      visualChangeset: apiVisualChangesetValidator,
    })
    .strict(),
  summary: "Create a visual changeset for an experiment",
  operationId: "postVisualChangesets",
  tags: ["visual-changesets"],
  method: "post" as const,
  path: "/experiments/:id/visual-changesets",
  exampleRequest: {
    params: { id: "abc123" },
    body: {
      editorUrl: "https://example.com/",
      urlPatterns: [{ type: "simple" as const, pattern: "/", include: true }],
    },
  },
};

export const getVisualChangesetValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      includeExperiment: z.coerce
        .number()
        .int()
        .describe("Include the associated experiment in payload")
        .optional(),
    })
    .strict(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      visualChangeset: apiVisualChangesetValidator,
      experiment: apiExperimentValidator.optional(),
    })
    .strict(),
  summary: "Get a single visual changeset",
  operationId: "getVisualChangeset",
  tags: ["visual-changesets"],
  method: "get" as const,
  path: "/visual-changesets/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const putVisualChangesetValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      nModified: z.coerce.number(),
      visualChangeset: apiVisualChangesetValidator,
    })
    .strict(),
  summary: "Update a visual changeset",
  operationId: "putVisualChangeset",
  tags: ["visual-changesets"],
  method: "put" as const,
  path: "/visual-changesets/:id",
  exampleRequest: {
    params: { id: "abc123" },
  },
};

export const postVisualChangeValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      nModified: z.coerce.number(),
    })
    .strict(),
  summary: "Create a visual change for a visual changeset",
  operationId: "postVisualChange",
  tags: ["visual-changesets"],
  method: "post" as const,
  path: "/visual-changesets/:id/visual-change",
  exampleRequest: {},
};

export const putVisualChangeValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z
    .object({
      id: z.string().describe("The id of the requested resource"),
      visualChangeId: z.string().describe("Specify a specific visual change"),
    })
    .strict(),
  responseSchema: z
    .object({
      nModified: z.coerce.number(),
    })
    .strict(),
  summary: "Update a visual change for a visual changeset",
  operationId: "putVisualChange",
  tags: ["visual-changesets"],
  method: "put" as const,
  path: "/visual-changesets/:id/visual-change/:visualChangeId",
  exampleRequest: {},
};
