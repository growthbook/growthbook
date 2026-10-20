import { z } from "zod";
import { namedSchema } from "./openapi-helpers";
import { apiAdditionalRoles } from "./members";
import { apiBaseSchema } from "./base-model";

// Organization secret keys only: never the key value, PATs, SDK keys or OAuth tokens.
export const apiApiKeyValidator = namedSchema(
  "ApiKey",
  apiBaseSchema
    .safeExtend({
      description: z.string(),
      role: z.string(),
      limitAccessByEnvironment: z.boolean(),
      environments: z.array(z.string()),
      additionalRoles: apiAdditionalRoles,
      projectRoles: z
        .array(
          z.object({
            project: z.string(),
            role: z.string(),
            limitAccessByEnvironment: z.boolean(),
            environments: z.array(z.string()),
            additionalRoles: apiAdditionalRoles,
          }),
        )
        .optional(),
      disabled: z.boolean(),
      lastUsed: z
        .string()
        .meta({ format: "date-time" })
        .nullable()
        .describe("Null when the key has never been used"),
    })
    .strict(),
);

const idParams = z
  .object({ id: z.string().describe("The API key id (not the secret)") })
  .strict();

// No create or update over REST: keys are made and edited in the app.
export const apiCreateApiKeyBody = z.strictObject({});
export const apiUpdateApiKeyBody = z.strictObject({});

export const apiListApiKeysValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const apiApiKeyActionValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
};

export const apiApiKeyActionReturn = z
  .object({ apiKey: apiApiKeyValidator })
  .strict();
