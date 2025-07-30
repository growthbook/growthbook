import {
  HoldoutInterface,
  holdoutValidator,
} from "back-end/src/routers/holdout/holdout.validators";
import { MakeModelClass } from "./BaseModel";

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
    updates: HoldoutInterface
  ): boolean {
    return this.context.permissions.canUpdateHoldout(existing, updates);
  }
  protected canDelete(doc: HoldoutInterface): boolean {
    return this.context.permissions.canDeleteHoldout(doc);
  }

  // TODO: Add additional filtering for holdouts. Check that holdout is still active
  public async getAllPayloadHoldouts(environment?: string) {
    const holdouts = await this._find({});
    const filteredHoldouts = holdouts.filter((h) => {
      if (environment) {
        return h.environmentSettings[environment].enabled;
      }
      return true;
    });
    // if (!filteredHoldouts || filteredHoldouts.length === 0) {
    //   return new Map();
    // }
    // return new Map(filteredHoldouts.map((h) => [h.id, h]));
    return filteredHoldouts;
  }

  public async removeExperimentFromHoldout(
    holdoutId: string,
    experimentId: string
  ) {
    const holdout = await this.getById(holdoutId);
    if (!holdout) {
      throw new Error("Holdout not found");
    }
    const {
      [experimentId]: _,
      ...linkedExperiments
    } = holdout.linkedExperiments;
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
