import { MakeModelClass } from "back-end/src/models/BaseModel";
import {
  experimentVectors,
  ExperimentVectors,
} from "back-end/src/validators/experiment-vectors";
//import { ExperimentInterface } from "back-end/src/validators/experiments";

const BaseClass = MakeModelClass({
  schema: experimentVectors,
  collectionName: "experimentvectors",
  idPrefix: "exv__",
  auditLog: {
    entity: "experimentVector",
    createEvent: "experimentVector.create",
    updateEvent: "experimentVector.update",
    deleteEvent: "experimentVector.delete",
  },
  globallyUniqueIds: true,
});

export class ExperimentVectorsModel extends BaseClass {
  protected canRead(): boolean {
    return true;
  }
  protected canCreate(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return this.canCreate();
  }
  protected canDelete(): boolean {
    return this.canCreate();
  }

  public getByExperimentIds(ids: string[]) {
    // Make sure ids is an array of strings
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
      throw new Error("Invalid ids");
    }
    if (!ids.length) return Promise.resolve([]);

    return this._find({ experimentId: { $in: ids } });
  }

  public async addOrUpdate(
    experimentId: string,
    obj: Partial<ExperimentVectors>
  ) {
    if (!experimentId) {
      throw new Error("Experiment ID and vectors are required.");
    }
    // Check if the experiment vector already exists
    const existingVector = await this._findOne({ experimentId });
    if (existingVector) {
      // Update the existing vector
      return await this.update(existingVector, obj);
    }
    if (!obj.embeddings || obj.embeddings.length === 0) {
      throw new Error(
        "Embeddings are required to create an experiment vector."
      );
    }
    return await this.create({
      ...obj,
      experimentId,
      embeddings: obj.embeddings as number[],
    });
  }
}
