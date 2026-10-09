import { z } from "zod";

export const experimentExposureRecordValidator = z.object({
  timestamp: z.string(),
  userId: z.string().nullable(),
  variationId: z.string(),
  // Dimensions declared on the exposure query. Filterable, and shown as columns.
  dimensions: z.record(z.string(), z.string().nullable()),
  // Every other column the exposure query returned. Display-only, surfaced when
  // a row is expanded. Nested so a column named e.g. "timestamp" cannot shadow
  // a typed field above.
  extra: z.record(z.string(), z.string().nullable()),
});

export type ExperimentExposureRecord = z.infer<
  typeof experimentExposureRecordValidator
>;
