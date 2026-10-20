import { z } from "zod";
import { apiBaseSchema } from "./base-model";
import { namedSchema } from "./openapi-helpers";
import { readOnlyEcho } from "./shared";

export const destinationUrlValidator = z
  .object({
    url: z.string(),
    variation: z.string(),
  })
  .strict();

export const urlRedirectValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    experiment: z.string(),
    urlPattern: z.string(),
    destinationURLs: z.array(destinationUrlValidator),
    persistQueryString: z.boolean(),
  })
  .strict();

export const apiUrlRedirectValidator = namedSchema(
  "UrlRedirect",
  apiBaseSchema.safeExtend({
    experiment: z.string().describe("The experiment this redirect belongs to"),
    urlPattern: z
      .string()
      .describe("Visitors on URLs matching this are redirected"),
    destinationURLs: z
      .array(destinationUrlValidator)
      .describe("One destination per variation id"),
    persistQueryString: z.boolean(),
  }),
);

export const apiCreateUrlRedirectBody = z.strictObject({
  experiment: z.string(),
  urlPattern: z.string(),
  destinationURLs: z
    .array(destinationUrlValidator)
    .describe("Must include every variation in the experiment's latest phase"),
  persistQueryString: z.boolean().optional(),
});

export const apiUpdateUrlRedirectBody = apiCreateUrlRedirectBody
  .omit({ experiment: true })
  .partial()
  .extend({
    id: readOnlyEcho,
    experiment: readOnlyEcho,
    dateCreated: readOnlyEcho,
    dateUpdated: readOnlyEcho,
  })
  .describe(
    "Read-only fields from the GET response (`id`, `experiment`, `dateCreated`, `dateUpdated`) are accepted and ignored, so a redirect can be sent back with only the changes.",
  );

export const apiListUrlRedirectsValidator = {
  paramsSchema: z.never(),
  bodySchema: z.never(),
  querySchema: z.strictObject({
    experimentId: z.string().optional(),
  }),
};
