import { z } from "zod/v4";

export const queryStatusValidator = z.enum([
  "queued",
  "running",
  "failed",
  "partially-succeeded",
  "succeeded",
]);

export const queryPointerValidator = z
  .object({
    query: z.string(),
    status: queryStatusValidator,
    name: z.string(),
  })
  .strict();
