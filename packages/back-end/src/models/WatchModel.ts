import {
  UpdateWatchOptions,
  WatchInterface,
  watchSchema,
} from "shared/validators";
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

  // A re-watch writes nothing (FerretDB 2.x duplicates the array on a no-op
  // $addToSet); a new item is one atomic upsert, so concurrent creates can't collide.
  public async upsertWatch({ userId, item, type }: UpdateWatchOptions) {
    const collection = this._dangerousGetCollection();
    const watcher = { organization: this.context.org.id, userId };
    const watching = await collection.findOne(
      { ...watcher, [type]: item },
      { projection: { _id: 1 } },
    );
    if (watching) return;
    const now = new Date();
    await collection.updateOne(
      watcher,
      {
        $addToSet: { [type]: item },
        $set: { dateUpdated: now },
        $setOnInsert: {
          dateCreated: now,
          [type === "experiments" ? "features" : "experiments"]: [],
        },
      },
      { upsert: true },
    );
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
