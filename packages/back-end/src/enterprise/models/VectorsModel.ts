import { MakeModelClass } from "back-end/src/models/BaseModel";
import { vectors, Vectors } from "back-end/src/validators/vectors";

const BaseClass = MakeModelClass({
  schema: vectors,
  collectionName: "vectors",
  idPrefix: "exv__",
  auditLog: {
    entity: "vector",
    createEvent: "vector.create",
    updateEvent: "vector.update",
    deleteEvent: "vector.delete",
  },
  globallyUniquePrimaryKeys: true,
});

export class VectorsModel extends BaseClass {
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

    return this._find({ joinId: { $in: ids }, type: "experiment" });
  }

  public getByMetricIds(ids: string[]) {
    // Make sure ids is an array of strings
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
      throw new Error("Invalid ids");
    }
    if (!ids.length) return Promise.resolve([]);

    return this._find({ joinId: { $in: ids }, type: "metric" });
  }

  public async addOrUpdateExperimentVector(
    experimentId: string,
    obj: Partial<Vectors>,
  ) {
    return await this.addOrUpdate(experimentId, "experiment", obj);
  }

  public async addOrUpdateMetricVector(
    metricId: string,
    obj: Partial<Vectors>,
  ) {
    return await this.addOrUpdate(metricId, "metric", obj);
  }

  public async addOrUpdate(
    joinId: string,
    type: "experiment" | "metric",
    obj: Partial<Vectors>,
  ) {
    if (!joinId) {
      throw new Error("JoinId is required.");
    }
    // Check if the experiment vector already exists
    const existingVector = await this._findOne({
      type: type,
      joinId: joinId,
    });
    if (existingVector) {
      // Update the existing vector
      return await this.update(existingVector, obj);
    }
    if (!obj.embeddings || obj.embeddings.length === 0) {
      throw new Error(
        "Embeddings are required to create an experiment vector.",
      );
    }
    return await this.create({
      ...obj,
      joinId,
      type,
      embeddings: obj.embeddings as number[],
    });
  }
}
