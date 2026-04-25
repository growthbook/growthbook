import { z } from "zod";

import { namedSchema } from "./openapi-helpers";

export const updateEnvOrderValidator = z
  .object({
    envId: z.string(),
    newIndex: z.number(),
  })
  .strict();

// We don't support changing an envs id, so it's not included in the putEnvironment endpoint
export const updateEnvValidator = z.object({
  environment: z
    .object({
      description: z.string(),
      toggleOnList: z.boolean().optional(),
      defaultState: z.any().optional(),
      projects: z.array(z.string()).optional(),
    })
    .strict(),
});

export const environment = z
  .object({
    id: z.string(),
    description: z.string(),
    toggleOnList: z.boolean().optional(),
    defaultState: z.boolean().optional(),
    projects: z.array(z.string()).optional(),
    parent: z.string().optional(),
  })
  .strict();

export const createEnvValidator = z.object({
  environment: environment.strict(),
});

export const updateEnvsValidator = z.object({
  environments: z.array(environment),
});

export const deleteEnvValidator = z.object({ id: z.string() }).strict();

// --- External REST API validators ---

// Corresponds to schemas/Environment.yaml
export const apiEnvironmentValidator = namedSchema(
  "Environment",
  z
    .object({
      id: z.string(),
      description: z.string(),
      toggleOnList: z.boolean(),
      defaultState: z.boolean(),
      projects: z.array(z.string()),
      parent: z.string().optional(),
    })
    .strict(),
);

// Corresponds to paths/postEnvironment.yaml requestBody
const postEnvironmentBody = z
  .object({
    id: z.string().describe("The ID of the new environment"),
    description: z
      .string()
      .describe("The description of the new environment")
      .optional(),
    toggleOnList: z
      .boolean()
      .describe("Show toggle on feature list")
      .optional(),
    defaultState: z
      .boolean()
      .describe("Default state for new features")
      .optional(),
    projects: z.array(z.string()).optional(),
    parent: z
      .string()
      .describe(
        "An environment that the new environment should inherit feature rules from. Requires an enterprise license",
      )
      .optional(),
  })
  .strict();

// Corresponds to paths/putEnvironment.yaml requestBody
const putEnvironmentBody = z
  .object({
    description: z
      .string()
      .describe("The description of the new environment")
      .optional(),
    toggleOnList: z
      .boolean()
      .describe("Show toggle on feature list")
      .optional(),
    defaultState: z
      .boolean()
      .describe("Default state for new features")
      .optional(),
    projects: z.array(z.string()).optional(),
  })
  .strict();

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listEnvironmentsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      environments: z.array(apiEnvironmentValidator),
    })
    .strict(),
  summary: "Get the organization's environments",
  operationId: "listEnvironments",
  tags: ["environments"],
  method: "get" as const,
  path: "/environments",
};

export const postEnvironmentValidator = {
  bodySchema: postEnvironmentBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      environment: apiEnvironmentValidator,
    })
    .strict(),
  summary: "Create a new environment",
  operationId: "postEnvironment",
  tags: ["environments"],
  method: "post" as const,
  path: "/environments",
  exampleRequest: {
    body: { id: "new-env", description: "My new environment" },
  },
};

export const putEnvironmentValidator = {
  bodySchema: putEnvironmentBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      environment: apiEnvironmentValidator,
    })
    .strict(),
  summary: "Update an environment",
  operationId: "putEnvironment",
  tags: ["environments"],
  method: "put" as const,
  path: "/environments/:id",
  exampleRequest: {
    params: { id: "abc123" },
    body: { description: "My updated environment" },
  },
};

export const deleteEnvironmentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      deletedId: z.string(),
    })
    .strict(),
  summary: "Deletes a single environment",
  operationId: "deleteEnvironment",
  tags: ["environments"],
  method: "delete" as const,
  path: "/environments/:id",
  exampleRequest: { params: { id: "abc123" } },
};
