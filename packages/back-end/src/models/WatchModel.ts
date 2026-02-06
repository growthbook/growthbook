import {
  UpdateWatchOptions,
  WatchInterface,
  watchSchema,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: watchSchema,
  collectionName: "watches",
  idPrefix: "watch_",
  readonlyFields: [],
  additionalIndexes: [{ unique: true, fields: { userId: 1, organization: 1 } }],
});

export class WatchModel extends BaseClass {
  protected async migrateModel() {
    const numNullIds = await this._dangerousCountGlobalDocuments({ id: null });
    // We need to generate a new ID for each document, so we create N updateOne operations
    // From mongo docs: updateOne updates a single document in the collection that matches the filter.
    // If multiple documents match, updateOne will update the first matching document only.
    await this._dangerousBulkWrite(
      Array.from({ length: numNullIds }, () => ({
        updateOne: {
          filter: { id: null },
          update: { $set: { id: this._generateId() } },
        },
      })),
      true, // Ordered to prevent the sequential `updateOne`s from running in parallel
    );
  }

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

  public async upsertWatch({ userId, item, type }: UpdateWatchOptions) {
    const existing = await this.getWatchedByUser(userId);
    existing
      ? await this._updateOne(existing, { [type]: [...existing[type], item] })
      : await this._createOne({
          userId,
          experiments: type === "experiments" ? [item] : [],
          features: type === "features" ? [item] : [],
        });
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
