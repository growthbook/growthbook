import mongoose from "mongoose";
import omit from "lodash/omit";
import { NotificationEventResource } from "shared/types/events/base-types";
import { logger } from "back-end/src/util/logger";

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

const schema = new mongoose.Schema<EventWebHookCoalesceBucketInterface>({
  id: { type: String, required: true, unique: true },
  organizationId: { type: String, required: true },
  eventWebHookId: { type: String, required: true },
  objectType: { type: String, required: true },
  objectId: { type: String, required: true },
  eventIds: { type: [String], required: true, default: [] },
  firstSeenAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  flushAt: { type: Date, required: true },
});
schema.index(
  { organizationId: 1, eventWebHookId: 1, objectType: 1, objectId: 1 },
  { unique: true, name: "ewh_coalesce_key_unique" },
);
schema.index({ flushAt: 1 }, { expireAfterSeconds: 60 * 60 });

type BucketDoc = mongoose.Document & EventWebHookCoalesceBucketInterface;
const toInterface = (doc: BucketDoc) =>
  omit(doc.toJSON(), ["__v", "_id"]) as EventWebHookCoalesceBucketInterface;

export const EventWebHookCoalesceBucketModel = mongoose.model(
  "EventWebHookCoalesceBucket",
  schema,
);

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
}) => {
  try {
    const result = await EventWebHookCoalesceBucketModel.findOneAndUpdate(
      { organizationId, eventWebHookId, objectType, objectId },
      {
        $setOnInsert: {
          id: `ewhcb-${new mongoose.Types.ObjectId().toHexString()}`,
          organizationId,
          eventWebHookId,
          objectType,
          objectId,
          firstSeenAt: now,
          flushAt: new Date(now.getTime() + windowMs),
        },
        $addToSet: { eventIds: eventId },
        $set: { lastSeenAt: now },
      },
      { upsert: true, new: true, rawResult: true },
    );
    const raw = result as unknown as {
      value: BucketDoc | null;
      lastErrorObject?: { upserted?: unknown };
    };
    return raw.value
      ? { bucket: toInterface(raw.value), scheduledFlush: !!raw.lastErrorObject?.upserted }
      : null;
  } catch (error) {
    logger.error(error, "upsertCoalesceBucket failed");
    return null;
  }
};

export const claimCoalesceBucket = async (key: {
  organizationId: string;
  eventWebHookId: string;
  objectType: NotificationEventResource;
  objectId: string;
}) => {
  const doc = await EventWebHookCoalesceBucketModel.findOneAndDelete(key);
  return doc ? toInterface(doc) : null;
};

export const deleteCoalesceBucketsForWebhook = async (key: {
  organizationId: string;
  eventWebHookId: string;
}) => {
  const result = await EventWebHookCoalesceBucketModel.deleteMany(key);
  return result.deletedCount ?? 0;
};
