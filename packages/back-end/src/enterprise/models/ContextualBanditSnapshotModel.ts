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
        phase: 1,
        dateCreated: -1,
      },
    },
    {
      fields: { contextualBanditEventId: 1 },
    },
  ],
});

export class ContextualBanditSnapshotModel extends BaseClass {
  // Snapshot ACL is delegated to the HTTP boundary post-PR-8: every CB
  // GET / refresh handler resolves the parent CB first and gates on
  // `canRunContextualBandit` / `canReadSingleProjectResource(cb.project)`
  // before touching the CBS model. The framework's `getForeignRefs`
  // experiment-keyed lookup is gone with the FK; there is no per-doc
  // project to gate on, and the CB-level gate at the route is sufficient.
  // Callers that bypass the route (none in v1) accept the risk by going
  // through the model directly.
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
    phase: number,
  ): Promise<ContextualBanditSnapshotInterface | null> {
    const results = await this._find(
      { contextualBandit, phase },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return results[0] ?? null;
  }

  public async listForContextualBandit(
    contextualBandit: string,
    phase: number,
    limit = 20,
  ): Promise<ContextualBanditSnapshotInterface[]> {
    return this._find(
      { contextualBandit, phase },
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
