import { z } from "zod";

export const createUrlRedirectValidator = z
  .object({
    experiment: z.string(),
    urlPattern: z.string(),
    destinationURLs: z.array(
      z
        .object({
          url: z.string(),
          variation: z.string(),
        })
        .strict(),
    ),
    persistQueryString: z.boolean(),
  })
  .strict();

export const updateUrlRedirectValidator = createUrlRedirectValidator
  .omit({ experiment: true })
  .partial();
