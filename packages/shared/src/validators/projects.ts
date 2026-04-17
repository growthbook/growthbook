import { z } from "zod";
import { statsEngines } from "shared/constants";
import { managedByValidator } from "./managed-by";
import { baseSchema } from "./base-model";
import { paginationQueryFields } from "./shared";

import { namedSchema } from "./openapi-helpers";

export const statsEnginesValidator = z.enum(statsEngines);

export const projectSettingsValidator = z.object({
  statsEngine: statsEnginesValidator.optional(),
  confidenceLevel: z.number().min(0.5).max(1).optional(),
  pValueThreshold: z.number().gt(0).max(0.5).optional(),
});

export const projectValidator = baseSchema
  .extend({
    name: z.string(),
    description: z.string().optional(),
    publicId: z.string().optional(),
    settings: projectSettingsValidator.optional(),
    managedBy: managedByValidator.optional(),
  })
  .strict();

export type StatsEngine = z.infer<typeof statsEnginesValidator>;
export type ProjectSettings = z.infer<typeof projectSettingsValidator>;
export type ProjectInterface = z.infer<typeof projectValidator>;

// --- API validators (migrated from openapi.ts) ---

// Corresponds to schemas/Project.yaml
export const apiProjectValidator = namedSchema(
  "Project",
  z
    .object({
      id: z.string(),
      name: z.string(),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
      description: z.string().optional(),
      publicId: z
        .string()
        .describe(
          "URL-safe slug used in SDK payload metadata. Auto-generated from name if not provided.",
        )
        .optional(),
      settings: z
        .object({
          statsEngine: z.string().optional(),
          confidenceLevel: z.number().optional(),
          pValueThreshold: z.number().optional(),
        })
        .optional(),
    })
    .strict(),
);

export type ApiProject = z.infer<typeof apiProjectValidator>;

// Corresponds to payload-schemas/PostProjectPayload.yaml
const postProjectBody = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    publicId: z
      .string()
      .describe(
        "URL-safe slug (lowercase letters, numbers, dashes). Auto-generated from name if not provided.",
      )
      .optional(),
    settings: z
      .object({
        statsEngine: z.string().describe("Stats engine.").optional(),
        confidenceLevel: z
          .number()
          .describe(
            "Bayesian chance-to-win threshold (stored as decimal, e.g. 0.95).",
          )
          .optional(),
        pValueThreshold: z
          .number()
          .describe("Frequentist p-value threshold (e.g. 0.05).")
          .optional(),
      })
      .describe(
        "Project stats settings that, when set, override the organization settings.",
      )
      .optional(),
  })
  .strict();

// Corresponds to payload-schemas/PutProjectPayload.yaml
const putProjectBody = z
  .object({
    name: z.string().describe("Project name.").optional(),
    description: z.string().describe("Project description.").optional(),
    publicId: z
      .string()
      .describe("URL-safe slug (lowercase letters, numbers, dashes).")
      .optional(),
    settings: z
      .object({
        statsEngine: z.string().describe("Stats engine.").optional(),
        confidenceLevel: z
          .number()
          .describe(
            "Bayesian chance-to-win threshold (stored as decimal, e.g. 0.95).",
          )
          .optional(),
        pValueThreshold: z
          .number()
          .describe("Frequentist p-value threshold (e.g. 0.05).")
          .optional(),
      })
      .describe(
        "Project stats settings that, when set, override the organization settings.",
      )
      .optional(),
  })
  .strict();

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

const listQuerySchema = z
  .object({
    ...paginationQueryFields,
  })
  .strict();

export const listProjectsValidator = {
  bodySchema: z.never(),
  querySchema: listQuerySchema,
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      projects: z.array(apiProjectValidator),
    }),
    z.object({
      limit: z.coerce.number().int(),
      offset: z.coerce.number().int(),
      count: z.coerce.number().int(),
      total: z.coerce.number().int(),
      hasMore: z.boolean(),
      nextOffset: z.union([z.coerce.number().int(), z.null()]),
    }),
  ),
  summary: "Get all projects",
  operationId: "listProjects",
  tags: ["projects"],
  method: "get" as const,
  path: "/projects",
};

export const postProjectValidator = {
  bodySchema: postProjectBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      project: apiProjectValidator,
    })
    .strict(),
  summary: "Create a single project",
  operationId: "postProject",
  tags: ["projects"],
  method: "post" as const,
  path: "/projects",
  exampleRequest: {
    body: { name: "My Project", description: "Super cool project" },
  },
};

export const getProjectValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      project: apiProjectValidator,
    })
    .strict(),
  summary: "Get a single project",
  operationId: "getProject",
  tags: ["projects"],
  method: "get" as const,
  path: "/projects/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const putProjectValidator = {
  bodySchema: putProjectBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      project: apiProjectValidator,
    })
    .strict(),
  summary: "Edit a single project",
  operationId: "putProject",
  tags: ["projects"],
  method: "put" as const,
  path: "/projects/:id",
  exampleRequest: {
    params: { id: "abc123" },
    body: { name: "My Subsidiary" },
  },
};

export const deleteProjectValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      deletedId: z
        .string()
        .describe("The ID of the deleted project")
        .meta({ example: "prj__123abc" }),
    })
    .strict(),
  summary: "Deletes a single project",
  operationId: "deleteProject",
  tags: ["projects"],
  method: "delete" as const,
  path: "/projects/:id",
  exampleRequest: { params: { id: "abc123" } },
};
