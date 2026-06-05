import {
  ContextualBanditSnapshotInterface,
  contextualBanditSnapshotValidator,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";

const BaseClass = MakeModelClass({
  schema: contextualBanditSnapshotValidator,
  collectionName: "contextualbanditsnapshots",
  idPrefix: "cbs_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        contextualBandit: 1,
        dateCreated: -1,
      },
    },
    {
      fields: { contextualBanditEventId: 1 },
    },
  ],
  // The legacy `{ organization, contextualBandit, phase, dateCreated }` index is dropped now
  // that `phase` is no longer part of the schema. Mongo will rebuild the new index on the
  // first read after deploy via `BaseModel.updateIndexes()`.
  indexesToRemove: ["organization_1_contextualBandit_1_phase_1_dateCreated_-1"],
});

export class ContextualBanditSnapshotModel extends BaseClass {
  // ACL is delegated to the HTTP boundary: route handlers gate on the parent CB before touching CBS.
  protected canRead(): boolean {
    return true;
  }
  protected canCreate(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return true;
  }
  protected canDelete(): boolean {
    return true;
  }

  public async getLatestForContextualBandit(
    contextualBandit: string,
  ): Promise<ContextualBanditSnapshotInterface | null> {
    const results = await this._find(
      { contextualBandit },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return results[0] ?? null;
  }

  public async listForContextualBandit(
    contextualBandit: string,
    limit = 20,
  ): Promise<ContextualBanditSnapshotInterface[]> {
    return this._find(
      { contextualBandit },
      { sort: { dateCreated: -1 }, limit },
    );
  }

  public async getBySnapshotIdInOrg(
    id: string,
  ): Promise<ContextualBanditSnapshotInterface | null> {
    const results = await this._find({ id });
    return results[0] ?? null;
  }

  public async deleteForContextualBandit(
    contextualBandit: string,
  ): Promise<void> {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      contextualBandit,
    });
  }
}
