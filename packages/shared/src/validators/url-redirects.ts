import { z } from "zod";

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
