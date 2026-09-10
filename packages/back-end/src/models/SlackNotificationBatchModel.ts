import {
  slackNotificationBatchSchema,
  SlackNotificationBatch,
} from "shared/validators";
import {
  getCollection,
  isDuplicateKeyError,
} from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

const COLLECTION = "slacknotificationbatches";
const BaseClass = MakeModelClass({
  schema: slackNotificationBatchSchema,
  collectionName: COLLECTION,
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    { fields: { expiresAt: 1 }, expireAfterSeconds: 0 },
    { fields: { status: 1, flushAt: 1 } },
    { fields: { status: 1, leaseUntil: 1 } },
  ],
});

export class SlackNotificationBatchModel extends BaseClass {
  protected canRead() {
    return this.context.permissions.canManageIntegrations();
  }
  protected canCreate() {
    return false;
  }
  protected canUpdate() {
    return false;
  }
  protected canDelete() {
    return false;
  }

  public async append(input: {
    id: string;
    eventWebHookId: string;
    experimentId: string;
    eventId: string;
    flushAt: Date;
  }): Promise<boolean> {
    const collection = getCollection<SlackNotificationBatch>(COLLECTION);
    await collection.createIndex({ id: 1 }, { unique: true });
    const scope = { id: input.id, organization: this.context.org.id };
    if (await collection.findOne({ ...scope, eventIds: input.eventId }))
      return true;
    const now = new Date();
    if (input.flushAt <= now) return false;
    try {
      await collection.updateOne(
        { ...scope, status: "pending", "eventIds.99": { $exists: false } },
        {
          $addToSet: { eventIds: input.eventId },
          $setOnInsert: {
            eventWebHookId: input.eventWebHookId,
            experimentId: input.experimentId,
            flushAt: input.flushAt,
            expiresAt: new Date(now.getTime() + 7 * 86400000),
            status: "pending",
            attempts: 0,
            dateCreated: now,
          },
          $set: { dateUpdated: now },
        },
        { upsert: true },
      );
      return true;
    } catch (error) {
      // A full/closed bucket falls back to normal delivery; never drop overflow.
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  }
  public async claim(
    id: string,
    now = new Date(),
  ): Promise<(SlackNotificationBatch & { leaseUntil: Date }) | null> {
    const leaseUntil = new Date(now.getTime() + 10 * 60 * 1000);
    const result = await getCollection<SlackNotificationBatch>(
      COLLECTION,
    ).findOneAndUpdate(
      {
        id,
        organization: this.context.org.id,
        flushAt: { $lte: now },
        $or: [
          { status: "pending" },
          { status: "processing", leaseUntil: { $lte: now } },
        ],
      },
      {
        $set: { status: "processing", leaseUntil, dateUpdated: now },
        $inc: { attempts: 1 },
      },
      { returnDocument: "after", projection: { _id: 0 } },
    );
    if (!result.value) return null;
    return { ...slackNotificationBatchSchema.parse(result.value), leaseUntil };
  }

  public async hasCurrentLease(id: string, leaseUntil: Date): Promise<boolean> {
    if (leaseUntil <= new Date()) return false;
    return !!(await getCollection<SlackNotificationBatch>(COLLECTION).findOne({
      id,
      organization: this.context.org.id,
      status: "processing",
      leaseUntil,
    }));
  }

  public async finish(
    id: string,
    leaseUntil: Date,
    status: "sent" | "failed",
  ): Promise<void> {
    await getCollection<SlackNotificationBatch>(COLLECTION).updateOne(
      {
        id,
        organization: this.context.org.id,
        status: "processing",
        leaseUntil,
      },
      { $set: { status, dateUpdated: new Date() }, $unset: { leaseUntil: "" } },
    );
  }

  public async release(id: string, leaseUntil: Date): Promise<void> {
    // A retry keeps the batch sealed so no events can arrive after its snapshot.
    await getCollection<SlackNotificationBatch>(COLLECTION).updateOne(
      {
        id,
        organization: this.context.org.id,
        status: "processing",
        leaseUntil,
      },
      { $set: { leaseUntil: new Date(0), dateUpdated: new Date() } },
    );
  }

  public static async dangerousGetDue(now: Date) {
    return getCollection<SlackNotificationBatch>(COLLECTION)
      .find({
        flushAt: { $lte: now },
        $or: [
          { status: "pending" },
          { status: "processing", leaseUntil: { $lte: now } },
        ],
      })
      .sort({ flushAt: 1 })
      .limit(100)
      .toArray();
  }
}
