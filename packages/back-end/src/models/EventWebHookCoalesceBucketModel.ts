import mongoose from "mongoose";
import omit from "lodash/omit";
import { NotificationEventResource } from "shared/types/events/base-types";
import { logger } from "back-end/src/util/logger";

/**
 * A short-lived buffer of events flushed to a chat-style webhook
 * (Slack/Discord) as a single digest message, one bucket per (org, webhook,
 * object) tuple. The first event stamps `flushAt`; events within the window are
 * appended and picked up by the existing flush job.
 */
export interface EventWebHookCoalesceBucketInterface {
  id: string;
  organizationId: string;
  eventWebHookId: string;
  objectType: NotificationEventResource;
  objectId: string;
  eventIds: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
  flushAt: Date;
}

const eventWebHookCoalesceBucketSchema =
  new mongoose.Schema<EventWebHookCoalesceBucketInterface>({
    id: {
      type: String,
      required: true,
      unique: true,
    },
    organizationId: { type: String, required: true },
    eventWebHookId: { type: String, required: true },
    objectType: { type: String, required: true },
    objectId: { type: String, required: true },
    eventIds: { type: [String], required: true, default: [] },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    flushAt: { type: Date, required: true },
  });

eventWebHookCoalesceBucketSchema.index(
  { organizationId: 1, eventWebHookId: 1, objectType: 1, objectId: 1 },
  { unique: true, name: "ewh_coalesce_key_unique" },
);

// TTL safety net: prune buckets that outlive an hour for any reason. Normal
// buckets flush within seconds.
eventWebHookCoalesceBucketSchema.index(
  { flushAt: 1 },
  { expireAfterSeconds: 60 * 60 },
);

type EventWebHookCoalesceBucketDocument = mongoose.Document &
  EventWebHookCoalesceBucketInterface;

const toInterface = (
  doc: EventWebHookCoalesceBucketDocument,
): EventWebHookCoalesceBucketInterface =>
  omit(doc.toJSON(), ["__v", "_id"]) as EventWebHookCoalesceBucketInterface;

export const EventWebHookCoalesceBucketModel =
  mongoose.model<EventWebHookCoalesceBucketInterface>(
    "EventWebHookCoalesceBucket",
    eventWebHookCoalesceBucketSchema,
  );

export type CoalesceBucketUpsertResult = {
  bucket: EventWebHookCoalesceBucketInterface;
  // True when this call inserted the bucket (and therefore the caller must
  // schedule the flush job). False when an existing bucket was extended.
  scheduledFlush: boolean;
};

/**
 * Add an event id to the bucket for (org, webhook, object), creating it if
 * needed. The returned `scheduledFlush` flag tells the caller whether to
 * schedule a flush. `$addToSet` de-dups event ids so repeated upserts of the
 * same id are a no-op (defensive against agenda retries).
 */
export const upsertCoalesceBucket = async ({
  organizationId,
  eventWebHookId,
  objectType,
  objectId,
  eventId,
  windowMs,
  now = new Date(),
}: {
  organizationId: string;
  eventWebHookId: string;
  objectType: NotificationEventResource;
  objectId: string;
  eventId: string;
  windowMs: number;
  now?: Date;
}): Promise<CoalesceBucketUpsertResult | null> => {
  const flushAt = new Date(now.getTime() + windowMs);

  try {
    const filter = { organizationId, eventWebHookId, objectType, objectId };
    const update = {
      $setOnInsert: {
        id: `ewhcb-${new mongoose.Types.ObjectId().toHexString()}`,
        organizationId,
        eventWebHookId,
        objectType,
        objectId,
        firstSeenAt: now,
        flushAt,
      },
      $addToSet: { eventIds: eventId },
      $set: { lastSeenAt: now },
    };

    // rawResult exposes Mongo's reply so we can tell an insert (schedule a
    // flush) from an append to an existing bucket.
    const result = await EventWebHookCoalesceBucketModel.findOneAndUpdate(
      filter,
      update,
      {
        upsert: true,
        new: true,
        rawResult: true,
        setDefaultsOnInsert: true,
      },
    );

    // In Mongoose 6 `rawResult: true` returns ModifyResult with `value`.
    const doc = (
      result as unknown as { value: EventWebHookCoalesceBucketDocument | null }
    ).value;
    if (!doc) return null;

    const scheduledFlush = !!(
      result as unknown as {
        lastErrorObject?: { upserted?: unknown };
      }
    ).lastErrorObject?.upserted;

    return { bucket: toInterface(doc), scheduledFlush };
  } catch (e) {
    logger.error(e, "upsertCoalesceBucket failed");
    return null;
  }
};

/**
 * Atomically remove the bucket and return its contents. The caller owns
 * delivery from here on; if delivery fails, the contents must be
 * preserved in the retry job's data.
 */
export const claimCoalesceBucket = async ({
  organizationId,
  eventWebHookId,
  objectType,
  objectId,
}: {
  organizationId: string;
  eventWebHookId: string;
  objectType: NotificationEventResource;
  objectId: string;
}): Promise<EventWebHookCoalesceBucketInterface | null> => {
  const doc = await EventWebHookCoalesceBucketModel.findOneAndDelete({
    organizationId,
    eventWebHookId,
    objectType,
    objectId,
  });
  return doc ? toInterface(doc) : null;
};

/**
 * Drop every coalesce bucket for a webhook. Called when the webhook is
 * deleted so we don't dispatch digests to a now-orphan integration.
 */
export const deleteCoalesceBucketsForWebhook = async ({
  organizationId,
  eventWebHookId,
}: {
  organizationId: string;
  eventWebHookId: string;
}): Promise<number> => {
  const result = await EventWebHookCoalesceBucketModel.deleteMany({
    organizationId,
    eventWebHookId,
  });
  return result.deletedCount ?? 0;
};
