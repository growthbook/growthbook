import { z } from "zod";

export const eventLogSummaryItemValidator = z.object({
  eventName: z.string(),
  totalCount: z.number().int().nonnegative(),
  dauCount: z.number().int().nonnegative(),
  dailyCounts: z.array(z.number().int().nonnegative()),
  // Most recent event of this name, deliberately NOT bounded by the selected
  // time window: an event that stopped arriving days ago should read as stale
  // no matter which window is in view.
  lastReceived: z.string().nullable(),
  // Earliest event of this name within the selected window. Bounded by the
  // window on purpose — it answers "did this first show up during the period
  // I'm looking at", which is what the "new" arrival status means.
  firstSeen: z.string().nullable(),
  // Earliest occurrence within the lookback rather than the window. "New" means
  // "did not exist before this window", which firstSeen alone cannot answer: it
  // is a MIN over in-window rows, so it always falls inside the window.
  firstEverSeen: z.string().nullable(),
  // Per identifier column defined on the data source: how many rows carried a
  // value, out of how many rows total, so the front end can show a share.
  identifierCoverage: z.array(
    z.object({
      identifier: z.string(),
      nonNullCount: z.number().int().nonnegative(),
      totalCount: z.number().int().nonnegative(),
    }),
  ),
  // Which GrowthBook objects reference this event. Resolved from Mongo
  // metadata, not from the warehouse.
  usedBy: z.object({
    factTableIds: z.array(z.string()),
    metricIds: z.array(z.string()),
  }),
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
