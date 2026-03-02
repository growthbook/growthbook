import { z } from "zod";

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
