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
  readonlyFields: ["savedGroupId", "version", "sourceKey", "fileKey", "size"],
  additionalIndexes: [
    {
      fields: { organization: 1, savedGroupId: 1, version: 1 },
      unique: true,
    },
    // One upload per uploaded file, so submitting it twice can't make two
    {
      fields: { organization: 1, sourceKey: 1 },
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

  /**
   * A page of a group's uploads, newest first. Access is checked on the saved
   * group (see `canRead`), so the database can apply the limit.
   */
  public async getPageBySavedGroup(
    savedGroupId: string,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<{ uploads: SavedGroupUploadInterface[]; total: number }> {
    const [uploads, total] = await Promise.all([
      this._find(
        { savedGroupId },
        {
          sort: { version: -1 },
          limit,
          skip: offset,
          bypassReadPermissionChecks: true,
        },
      ),
      this._countDocuments({ savedGroupId }),
    ]);
    return { uploads, total };
  }

  public getBySourceKey(sourceKey: string) {
    return this._findOne({ sourceKey });
  }

  public getVersion(savedGroupId: string, version: number) {
    return this._findOne({ savedGroupId, version });
  }

  /**
   * The newest upload of a group, valid only when `validOnly`. Access is
   * checked on the saved group (see `canRead`), so skipping the per-document
   * read check lets the database apply the limit.
   */
  public async getLatest(
    savedGroupId: string,
    { validOnly = false }: { validOnly?: boolean } = {},
  ): Promise<SavedGroupUploadInterface | null> {
    const [latest] = await this._find(
      (validOnly
        ? { savedGroupId, "status.type": "valid" }
        : { savedGroupId }) as Parameters<typeof this._find>[0],
      { sort: { version: -1 }, limit: 1, bypassReadPermissionChecks: true },
    );
    return latest ?? null;
  }

  /** The latest valid upload of each of `savedGroupIds`, one query each. */
  public async getLatestValidBySavedGroups(
    savedGroupIds: string[],
  ): Promise<Map<string, SavedGroupUploadInterface>> {
    const uploads = await Promise.all(
      savedGroupIds.map((id) => this.getLatest(id, { validOnly: true })),
    );
    return new Map(
      uploads
        .filter((u): u is SavedGroupUploadInterface => !!u)
        .map((u) => [u.savedGroupId, u]),
    );
  }
}
