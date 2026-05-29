import { getAffectedEnvsForExperiment } from "shared/util";
import {
  ContextualBanditInterface,
  contextualBanditValidator,
  LeafWeight,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";

const BaseClass = MakeModelClass({
  schema: contextualBanditValidator,
  collectionName: "contextualbandits",
  idPrefix: "cb_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: { organization: 1, experiment: 1 },
      unique: true,
    },
  ],
  // TODO(holdout-v1.5): these two fields are intentionally inert in v1; the
  // defaults let callers omit them so future docs round-trip cleanly without
  // a schema break when the holdout pipeline ships.
  defaultValues: {
    holdoutPercent: 0,
    stickyBucketing: false,
  },
});

export class ContextualBanditModel extends BaseClass {
  // CB docs are scoped to a parent experiment, so all RBAC delegates to the
  // parent's permissions (matches URLRedirect / snapshot precedent). Missing
  // parent is treated as no-access — never default-allow.
  protected canRead(doc: ContextualBanditInterface): boolean {
    const { experiment } = this.getForeignRefs(doc, false);
    if (!experiment) return false;
    return this.context.permissions.canReadSingleProjectResource(
      experiment.project,
    );
  }

  private canWrite(doc: ContextualBanditInterface): boolean {
    const { experiment } = this.getForeignRefs(doc, false);
    if (!experiment) return false;
    const envs = getAffectedEnvsForExperiment({
      experiment,
      orgEnvironments: this.context.org.settings?.environments || [],
    });
    return this.context.permissions.canRunExperiment(experiment, envs);
  }

  protected canCreate(doc: ContextualBanditInterface): boolean {
    return this.canWrite(doc);
  }
  protected canUpdate(existing: ContextualBanditInterface): boolean {
    return this.canWrite(existing);
  }
  protected canDelete(doc: ContextualBanditInterface): boolean {
    const { experiment } = this.getForeignRefs(doc, false);
    if (!experiment) return false;
    return this.context.permissions.canDeleteExperiment(experiment);
  }

  public async getByExperimentId(
    experiment: string,
  ): Promise<ContextualBanditInterface | null> {
    const results = await this._find({ experiment });
    return results[0] ?? null;
  }

  /**
   * Atomically update the leaf weights for a specific phase index.
   * Replaces `phases[phaseIndex].currentLeafWeights` in place via a single
   * Mongo `$set` with positional dot-notation — concurrent refreshes (cron
   * + manual API + scheduled retraining) can collide on the same CB doc,
   * and a read-modify-write would lose updates between the read and the
   * write. The atomic positional update guarantees only the target field
   * changes regardless of overlapping writers.
   */
  public async patchPhaseWeights(
    cbId: string,
    phaseIndex: number,
    leafWeights: LeafWeight[],
  ): Promise<ContextualBanditInterface> {
    const existing = await this.getById(cbId);
    if (!existing) {
      throw new Error(`ContextualBandit not found: ${cbId}`);
    }
    if (phaseIndex < 0 || phaseIndex >= existing.phases.length) {
      throw new Error(
        `Phase index ${phaseIndex} out of range (0..${existing.phases.length - 1})`,
      );
    }
    // BaseModel.updateById would re-check canUpdate; we bypass it for the
    // atomic single-field update below, so re-assert the same gate here.
    if (!this.canUpdate(existing)) {
      this.context.permissions.throwPermissionError();
    }

    const collection = this._dangerousGetCollection();
    const now = new Date();
    const res = await collection.updateOne(
      {
        organization: this.context.org.id,
        id: cbId,
        // Guard against the phase being removed between the bounds check
        // above and this write. If the phase array shrank, the update no-ops
        // and we surface a clear error below.
        [`phases.${phaseIndex}`]: { $exists: true },
      },
      {
        $set: {
          [`phases.${phaseIndex}.currentLeafWeights`]: leafWeights,
          dateUpdated: now,
        },
      },
    );
    if (res.matchedCount === 0) {
      throw new Error(
        `ContextualBandit ${cbId} phases[${phaseIndex}] could not be updated`,
      );
    }

    const refreshed = await this.getById(cbId);
    if (!refreshed) {
      throw new Error(`ContextualBandit ${cbId} disappeared after update`);
    }
    return refreshed;
  }

  public async deleteForExperiment(experiment: string): Promise<void> {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      experiment,
    });
  }
}
