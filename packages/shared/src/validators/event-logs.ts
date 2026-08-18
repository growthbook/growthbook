import { z } from "zod";

export const eventLogSummaryItemValidator = z.object({
  eventName: z.string(),
  totalCount: z.number().int().nonnegative(),
  dauCount: z.number().int().nonnegative(),
  dailyCounts: z.array(z.number().int().nonnegative()),
});

export type EventLogSummaryItem = z.infer<typeof eventLogSummaryItemValidator>;

export const eventLogRecordValidator = z.object({
  eventUuid: z.string(),
  timestamp: z.string(),
  eventName: z.string(),
  userId: z.string().nullable(),
  deviceId: z.string().nullable(),
  environment: z.string().nullable(),
  properties: z.record(z.string(), z.unknown()),
  attributes: z.record(z.string(), z.unknown()),
  url: z.string().nullable(),
  geoCountry: z.string().nullable(),
  uaBrowser: z.string().nullable(),
  uaOs: z.string().nullable(),
  uaDeviceType: z.string().nullable(),
  sdkLanguage: z.string().nullable(),
  sdkVersion: z.string().nullable(),
});

export type EventLogRecord = z.infer<typeof eventLogRecordValidator>;
