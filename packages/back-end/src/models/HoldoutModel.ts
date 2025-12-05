import {
  HoldoutInterface,
  holdoutValidator,
} from "shared/src/validators/holdout";
import { ExperimentInterface } from "back-end/types/experiment";
import { MakeModelClass } from "./BaseModel";
import { getExperimentById } from "./ExperimentModel";

const BaseClass = MakeModelClass({
  schema: holdoutValidator,
  collectionName: "holdouts",
  idPrefix: "hld_",
  auditLog: {
    entity: "holdout",
    createEvent: "holdout.create",
    updateEvent: "holdout.update",
    deleteEvent: "holdout.delete",
  },
  globallyUniqueIds: false,
});

export class HoldoutModel extends BaseClass {
  // CRUD permission checks
  protected canCreate(doc: HoldoutInterface): boolean {
    return this.context.permissions.canCreateHoldout(doc);
  }
  protected canRead(doc: HoldoutInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }
  protected canUpdate(
    existing: HoldoutInterface,
    updates: HoldoutInterface,
  ): boolean {
    return this.context.permissions.canUpdateHoldout(existing, updates);
  }
  protected canDelete(doc: HoldoutInterface): boolean {
    return this.context.permissions.canDeleteHoldout(doc);
  }

  public async getAllPayloadHoldouts(
    environment?: string,
  ): Promise<
    Map<string, { holdout: HoldoutInterface; experiment: ExperimentInterface }>
  > {
    const holdouts = await this._find({});
    const holdoutsWithExperiments = await Promise.all(
      holdouts.map(async (h) => {
        const experiment = await getExperimentById(
          this.context,
          h.experimentId,
        );
        return { holdout: h, experiment };
      }),
    );

    const filteredHoldouts = holdoutsWithExperiments.filter(
      (
        h,
      ): h is {
        holdout: HoldoutInterface;
        experiment: ExperimentInterface;
      } => {
        if (!h.experiment) return false;
        if (h.experiment.archived) return false;
        if (h.experiment.status !== "running") return false;

        if (
          Object.keys(h.holdout.linkedExperiments).length === 0 &&
          Object.keys(h.holdout.linkedFeatures).length === 0
        )
          return false;
        if (
          environment &&
          !h.holdout.environmentSettings[environment]?.enabled
        ) {
          return false;
        }
        return true;
      },
    );
    if (!filteredHoldouts || filteredHoldouts.length === 0) {
      return new Map();
    }
    return new Map(filteredHoldouts.map((h) => [h.holdout.id, h]));
  }

  public async removeExperimentFromHoldout(
    holdoutId: string,
    experimentId: string,
  ) {
    const holdout = await this.getById(holdoutId);
    if (!holdout) {
      throw new Error("Holdout not found");
    }
    const { [experimentId]: _, ...linkedExperiments } =
      holdout.linkedExperiments;
    await this.updateById(holdoutId, { linkedExperiments });
  }

  public async removeFeatureFromHoldout(holdoutId: string, featureId: string) {
    const holdout = await this.getById(holdoutId);
    if (!holdout) {
      throw new Error("Holdout not found");
    }
    const { [featureId]: _, ...linkedFeatures } = holdout.linkedFeatures;
    await this.updateById(holdoutId, { linkedFeatures });
  }
}
