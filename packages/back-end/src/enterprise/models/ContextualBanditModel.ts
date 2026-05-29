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
});

export class ContextualBanditModel extends BaseClass {
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

  public async getByExperimentId(
    experiment: string,
  ): Promise<ContextualBanditInterface | null> {
    const results = await this._find({ experiment });
    return results[0] ?? null;
  }

  /**
   * Atomically update the leaf weights for a specific phase index.
   * Replaces `phases[phaseIndex].currentLeafWeights` in place.
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
    const phases = existing.phases.map((phase, i) =>
      i === phaseIndex ? { ...phase, currentLeafWeights: leafWeights } : phase,
    );
    return this.updateById(cbId, { phases });
  }

  public async deleteForExperiment(experiment: string): Promise<void> {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      experiment,
    });
  }
}
