import { z } from "zod";

export const listUsersValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      limit: z.coerce.number().int().default(10),
      offset: z.coerce.number().int().optional(),
      projectId: z.string().optional(),
      filter: z.string().optional(),
    })
    .strict(),
  paramsSchema: z.never(),
};

export const createUserValidator = {
  //TODO: The bodySchema will come through as a Buffer, but zod doesn't have a Buffer type.
  bodySchema: z.any(),
  // bodySchema: z
  //   .any()
  //   .refine(
  //     (val: string) =>
  //       val !== undefined /* or some other check to ensure proper format */
  //   ),
  querySchema: z
    .object({
      limit: z.coerce.number().int().default(10),
      offset: z.coerce.number().int().optional(),
      projectId: z.string().optional(),
      filter: z.string().optional(),
    })
    .strict(),
  paramsSchema: z.never(),
};
