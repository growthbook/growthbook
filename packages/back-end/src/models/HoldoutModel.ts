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
    return true;
  }
  protected canRead(doc: HoldoutInterface): boolean {
    return true;
  }
  protected canUpdate(
    existing: HoldoutInterface,
    updates: HoldoutInterface
  ): boolean {
    return true;
  }
  protected canDelete(doc: HoldoutInterface): boolean {
    return true;
  }

  // TODO: Add additional filtering for holdouts. Check that holdout is still active
  public async getAllPayloadHoldouts(environment?: string) {
    const holdouts = await this._find({});
    const filteredHoldouts = holdouts.filter((h) => {
      if (environment) {
        return h.environments.includes(environment);
      }
      return true;
    });
    // if (!filteredHoldouts || filteredHoldouts.length === 0) {
    //   return new Map();
    // }
    // return new Map(filteredHoldouts.map((h) => [h.id, h]));
    return filteredHoldouts;
  }
}
