import { deriveContextId } from "shared/util";
import {
  ContextualBanditEventInterface,
  contextualBanditEventValidator,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";

const BaseClass = MakeModelClass({
  schema: contextualBanditEventValidator,
  collectionName: "contextualbanditevents",
  idPrefix: "cbe_",
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
      fields: { snapshotId: 1 },
    },
  ],
  // The legacy `{ organization, contextualBandit, phase, dateCreated }` index is dropped now
  // that `phase` is no longer part of the schema. Mongo will rebuild the new index on the
  // first read after deploy via `BaseModel.updateIndexes()`.
  indexesToRemove: ["organization_1_contextualBandit_1_phase_1_dateCreated_-1"],
});

export class ContextualBanditEventModel extends BaseClass {
  // ACL is gated at the HTTP boundary; see ContextualBanditSnapshotModel.
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
  ): Promise<ContextualBanditEventInterface | null> {
    const results = await this._find(
      { contextualBandit },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return results[0] ?? null;
  }

  public async listForContextualBandit(
    contextualBandit: string,
    limit = 20,
  ): Promise<ContextualBanditEventInterface[]> {
    return this._find(
      { contextualBandit },
      { sort: { dateCreated: -1 }, limit },
    );
  }

  public async getContextHistory(
    contextualBandit: string,
    contextId: string,
  ): Promise<ContextualBanditEventInterface[]> {
    const events = await this.listForContextualBandit(contextualBandit, 100);
    return events.filter((e) =>
      e.responses.some(
        // Seed must match `persistContextualBanditEvent`'s write seed (the CB id).
        (r) => deriveContextId(contextualBandit, r.context) === contextId,
      ),
    );
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
