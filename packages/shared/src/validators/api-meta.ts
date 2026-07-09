import { z } from "zod";

// Server metadata endpoints. Tagged "meta" (not "version") so the generated
// CLI command group doesn't collide with the CLI's built-in `version` command.
export const getVersionValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      // Semver release version, e.g. "4.4.0".
      version: z.string(),
      // Short git commit SHA of the build; "" when build info is unavailable (dev).
      commit: z.string(),
      // Build date (YYYY-MM-DD); "" when build info is unavailable (dev). This is
      // the orderable field clients use for skew/compatibility checks.
      date: z.string(),
    })
    .strict(),
  summary: "Get the GrowthBook server version and build info",
  operationId: "getVersion",
  tags: ["meta"],
  method: "get" as const,
  path: "/version",
};
