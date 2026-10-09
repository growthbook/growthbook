import {
  SavedGroupUploadInterface,
  SavedGroupUploadLoad,
  SavedGroupUploadStatus,
  savedGroupUploadValidator,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: savedGroupUploadValidator,
  collectionName: "savedgroupuploads",
  idPrefix: "sgu_",
  globallyUniquePrimaryKeys: true,
  readonlyFields: ["savedGroupId", "version", "fileKey", "size"],
  additionalIndexes: [
    {
      fields: { organization: 1, savedGroupId: 1, version: 1 },
      unique: true,
    },
  ],
});

/**
 * Versions of a remote Saved Group's IDs. Access is checked on the Saved Group
 * by the service in `services/remoteSavedGroups.ts`, which is the only caller.
 */
export class SavedGroupUploadModel extends BaseClass {
  protected canRead(): boolean {
    return true;
  }
  protected canCreate(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return false;
  }
  protected canDelete(): boolean {
    return true;
  }

  /**
   * Sets the result of GrowthBook's check of the whole file. Only a `pending`
   * upload changes, so a rerun of the check can't overwrite a result.
   */
  public async setStatus(
    upload: SavedGroupUploadInterface,
    status: SavedGroupUploadStatus,
  ): Promise<void> {
    await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        id: upload.id,
        "status.type": "pending",
      },
      { $set: { status, dateUpdated: new Date() } },
    );
  }

  /**
   * Replaces a data store's load report on an upload, or adds it. Written
   * atomically, so reports from different stores at the same time can't
   * overwrite each other.
   */
  public async upsertLoad(
    upload: SavedGroupUploadInterface,
    load: SavedGroupUploadLoad,
  ): Promise<SavedGroupUploadInterface | null> {
    const collection = this._dangerousGetCollection();
    const filter = { organization: this.context.org.id, id: upload.id };
    // Twice at most: a concurrent first report from the same store can add
    // the entry between the two writes.
    for (let attempt = 0; attempt < 2; attempt++) {
      const replaced = await collection.updateOne(
        { ...filter, "loads.storeId": load.storeId },
        { $set: { "loads.$": load } },
      );
      if (replaced.matchedCount) break;
      const added = await collection.updateOne(
        { ...filter, "loads.storeId": { $ne: load.storeId } },
        { $push: { loads: load } },
      );
      if (added.matchedCount) break;
    }
    return this.getById(upload.id);
  }

  /** Newest first. */
  public getBySavedGroup(savedGroupId: string) {
    return this._find({ savedGroupId }, { sort: { version: -1 } });
  }

  public getByFileKey(fileKey: string) {
    return this._findOne({ fileKey });
  }

  public getVersion(savedGroupId: string, version: number) {
    return this._findOne({ savedGroupId, version });
  }

  public async getLatest(
    savedGroupId: string,
  ): Promise<SavedGroupUploadInterface | null> {
    const [latest] = await this._find(
      { savedGroupId },
      { sort: { version: -1 }, limit: 1 },
    );
    return latest ?? null;
  }

  /** The latest valid upload of each of `savedGroupIds`. */
  public async getLatestValidBySavedGroups(
    savedGroupIds: string[],
  ): Promise<Map<string, SavedGroupUploadInterface>> {
    const latest = new Map<string, SavedGroupUploadInterface>();
    if (!savedGroupIds.length) return latest;
    const uploads = await this._find(
      {
        savedGroupId: { $in: savedGroupIds },
        "status.type": "valid",
      } as Parameters<typeof this._find>[0],
      { sort: { version: -1 } },
    );
    for (const upload of uploads) {
      if (!latest.has(upload.savedGroupId)) {
        latest.set(upload.savedGroupId, upload);
      }
    }
    return latest;
  }
}
