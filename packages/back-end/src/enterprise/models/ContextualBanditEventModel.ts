import { deriveContextId, getAffectedEnvsForExperiment } from "shared/util";
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
  // CBE docs are scoped to a parent experiment; delegate all RBAC to the
  // parent. Missing parent → no-access (never default-allow).
  protected canRead(doc: ContextualBanditEventInterface): boolean {
    const { experiment } = this.getForeignRefs(doc, false);
    if (!experiment) return false;
    return this.context.permissions.canReadSingleProjectResource(
      experiment.project,
    );
  }

  private canWrite(doc: ContextualBanditEventInterface): boolean {
    const { experiment } = this.getForeignRefs(doc, false);
    if (!experiment) return false;
    const envs = getAffectedEnvsForExperiment({
      experiment,
      orgEnvironments: this.context.org.settings?.environments || [],
    });
    return this.context.permissions.canRunExperiment(experiment, envs);
  }

  protected canCreate(doc: ContextualBanditEventInterface): boolean {
    return this.canWrite(doc);
  }
  protected canUpdate(existing: ContextualBanditEventInterface): boolean {
    return this.canWrite(existing);
  }
  protected canDelete(doc: ContextualBanditEventInterface): boolean {
    const { experiment } = this.getForeignRefs(doc, false);
    if (!experiment) return false;
    return this.context.permissions.canDeleteExperiment(experiment);
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
