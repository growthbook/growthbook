import {
  UpdateWatchOptions,
  WatchInterface,
  watchSchema,
} from "shared/validators";
import { logger } from "back-end/src/util/logger";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: watchSchema,
  pKey: ["userId", "organization"] as const,
  collectionName: "watches",
  idPrefix: "watch_",
  readonlyFields: [],
  additionalIndexes: [{ fields: { organization: 1, experiments: 1 } }],
});

export class WatchModel extends BaseClass {
  protected canCreate(): boolean {
    return true;
  }
  protected canRead(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return true;
  }
  protected canDelete(): boolean {
    return true;
  }

  protected migrate(legacyWatch: unknown): WatchInterface {
    const typecast = legacyWatch as WatchInterface;
    return {
      ...typecast,
      dateCreated: typecast.dateCreated ?? new Date(),
      dateUpdated: typecast.dateUpdated ?? new Date(),
    };
  }

  public async getWatchedByUser(
    userId: string,
  ): Promise<WatchInterface | null> {
    return await this._findOne({
      userId,
    });
  }

  public async getExperimentWatchers(experimentId: string): Promise<string[]> {
    return (
      await this._find({
        experiments: experimentId,
      })
    ).map((watcher) => watcher.userId);
  }

  public async getFeatureWatchers(featureId: string): Promise<string[]> {
    return (
      await this._find({
        features: featureId,
      })
    ).map((watcher) => watcher.userId);
  }

  // The $ne filter skips the write when already watching: DocumentDB < v0.109
  // (FerretDB 2.x) re-appends the array as a duplicate field on a no-op
  // $addToSet combined with $set, doubling the doc on every save. An existing
  // doc that already has the item misses the filter and the upsert hits the
  // unique (organization, userId) index, so E11000 means "doc exists". The
  // non-upsert retry adds the item if a concurrent create won the race.
  // Watching is a side effect of saves, so failures are logged, not thrown.
  public async upsertWatch({ userId, item, type }: UpdateWatchOptions) {
    const filter = {
      organization: this.context.org.id,
      userId,
      [type]: { $ne: item },
    };
    const now = new Date();
    const update = {
      $addToSet: { [type]: item },
      $set: { dateUpdated: now },
    };
    try {
      try {
        await this._dangerousGetCollection().updateOne(
          filter,
          {
            ...update,
            $setOnInsert: {
              dateCreated: now,
              [type === "experiments" ? "features" : "experiments"]: [],
            },
          },
          { upsert: true },
        );
      } catch (e) {
        if (!isDuplicateKeyError(e)) throw e;
        await this._dangerousGetCollection().updateOne(filter, update);
      }
    } catch (e) {
      logger.error(e, `Error adding ${type} ${item} to watch for ${userId}`);
    }
  }

  public async deleteWatchedByEntity({
    userId,
    type,
    item,
  }: UpdateWatchOptions) {
    const existing = await this.getWatchedByUser(userId);
    if (!existing) this.context.throwNotFoundError();
    await this._updateOne(existing, {
      [type]: existing[type].filter((el) => el !== item),
    });
  }
}
