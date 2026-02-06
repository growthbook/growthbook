import {
  UpdateWatchOptions,
  WatchInterface,
  watchSchema,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: watchSchema,
  collectionName: "watches",
  idPrefix: "Watch", // TODO
  globallyUniqueIds: true,
  readonlyFields: [],
  additionalIndexes: [{ unique: true, fields: { userId: 1, organization: 1 } }],
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
