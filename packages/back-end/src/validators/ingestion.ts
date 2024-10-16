import { z } from "zod";

export const sdkData = z.record(
  z
    .object({
      client_key: z.string(),
      organization: z.string(),
      datasource: z.string(),
    })
    .strict()
);

export type SdkData = z.infer<typeof sdkData>;
