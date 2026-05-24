import { deriveContextId } from "shared/util";
import {
  ContextualBanditEventInterface,
  contextualBanditEventValidator,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: contextualBanditEventValidator,
  collectionName: "contextualbanditevents",
  idPrefix: "cbe_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        experiment: 1,
        phase: 1,
        dateCreated: -1,
      },
    },
    {
      fields: { snapshotId: 1 },
    },
  ],
});

export class ContextualBanditEventModel extends BaseClass {
  protected canCreate() {
    return true;
  }
  protected canRead() {
    return true;
  }
  protected canUpdate() {
    return true;
  }
  protected canDelete() {
    return true;
  }

  public async getLatestForExperiment(
    experiment: string,
    phase: number,
  ): Promise<ContextualBanditEventInterface | null> {
    const results = await this._find(
      { experiment, phase },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return results[0] ?? null;
  }

  public async listForExperiment(
    experiment: string,
    phase: number,
    limit = 20,
  ): Promise<ContextualBanditEventInterface[]> {
    return this._find(
      { experiment, phase },
      { sort: { dateCreated: -1 }, limit },
    );
  }

  public async getContextHistory(
    experiment: string,
    phase: number,
    contextId: string,
  ): Promise<ContextualBanditEventInterface[]> {
    const events = await this.listForExperiment(experiment, phase, 100);
    return events.filter((e) =>
      e.responses.some(
        (r) => deriveContextId(experiment, r.context) === contextId,
      ),
    );
  }

  public async deleteForExperiment(experiment: string): Promise<void> {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      experiment,
    });
  }
}
