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
  additionalIndexes: [
    { unique: true, fields: { userId: 1, organization: 1 } },
    { fields: { organization: 1, experiments: 1 } },
  ],
});

export class WatchModel extends BaseClass {
  protected async migrateModel() {
    const nullIdDocuments = await this._find(
      { id: null },
      {
        dangerousCrossOrganization: true,
        projection: { userId: 1, organization: 1 },
      },
    );
    if (nullIdDocuments.length) {
      await this._dangerousBulkWriteCrossOrganization(
        nullIdDocuments.map(({ userId, organization }) => ({
          updateOne: {
            filter: { userId, organization },
            update: { $set: { id: this._generateId() } },
          },
        })),
      );
    }
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
    if (existing) {
      const itemSet = new Set(existing[type]);
      itemSet.add(item);
      await this._updateOne(existing, { [type]: [...itemSet] });
    } else {
      await this._createOne({
        userId,
        experiments: type === "experiments" ? [item] : [],
        features: type === "features" ? [item] : [],
      });
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
