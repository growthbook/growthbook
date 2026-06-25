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
});

export class ContextualBanditEventModel extends BaseClass {
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
    limit?: number,
  ): Promise<ContextualBanditEventInterface[]> {
    return this._find(
      { contextualBandit },
      { sort: { dateCreated: -1 }, limit },
    );
  }

  public async getEventById(
    eventId: string,
  ): Promise<ContextualBanditEventInterface | null> {
    return this.getById(eventId);
  }

  public async deleteForContextualBandit(
    contextualBandit: string,
  ): Promise<void> {
    const events = await this._find({ contextualBandit });
    await Promise.all(events.map((event) => this.delete(event)));
  }
}
