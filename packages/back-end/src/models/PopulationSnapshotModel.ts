import {
  ApiPopulationSnapshot,
  PopulationSnapshotInterface,
  populationSnapshotApiSpec,
  populationSnapshotValidator,
} from "shared/validators";
import { getDailyPopulationSnapshots } from "shared/populations";
import { stringToBoolean } from "shared/util";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: populationSnapshotValidator,
  collectionName: "populationsnapshots",
  idPrefix: "popsnp_",
  globallyUniquePrimaryKeys: false,
  additionalIndexes: [
    { fields: { organization: 1, population: 1, dateCreated: -1 } },
  ],
  apiConfig: {
    modelKey: "populationSnapshots",
    openApiSpec: populationSnapshotApiSpec,
  },
});

// Snapshots have no projects of their own. Reads through the API check that the
// population is readable, and only the refresh service writes them.
export class PopulationSnapshotModel extends BaseClass {
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

  public async getLatestForPopulation(
    population: string,
  ): Promise<PopulationSnapshotInterface | null> {
    const results = await this._find(
      { population },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return results[0] ?? null;
  }

  public async deleteForPopulation(population: string): Promise<void> {
    const snapshots = await this._find({ population });
    await Promise.all(snapshots.map((snapshot) => this.delete(snapshot)));
  }

  public override async handleApiGet(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiGet"]>[0],
  ): Promise<ApiPopulationSnapshot> {
    const snapshot = await this.getById(req.params.id);
    if (
      !snapshot ||
      !(await this.context.models.populations.getById(snapshot.population))
    ) {
      return req.context.throwNotFoundError();
    }
    return this.toApiInterface(snapshot);
  }

  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ): Promise<ApiPopulationSnapshot[]> {
    const { populationId, latest, startDate, endDate } = req.query;

    let populationIds: string[];
    if (populationId) {
      if (!(await this.context.models.populations.getById(populationId))) {
        return req.context.throwNotFoundError(
          `Population ${populationId} not found`,
        );
      }
      populationIds = [populationId];
    } else {
      populationIds = (await this.context.models.populations.getAll()).map(
        (p) => p.id,
      );
    }

    if (stringToBoolean(latest?.toString())) {
      const snapshots = await Promise.all(
        populationIds.map((id) => this.getLatestForPopulation(id)),
      );
      return snapshots
        .filter((s): s is PopulationSnapshotInterface => !!s)
        .map((s) => this.toApiInterface(s));
    }

    const asOf: { $gte?: Date; $lte?: Date } = {};
    if (startDate) asOf.$gte = new Date(startDate);
    if (endDate) asOf.$lte = new Date(endDate);
    const snapshots = await this._find({
      population: { $in: populationIds },
      status: "success",
      ...(Object.keys(asOf).length ? { asOf } : {}),
    });

    return populationIds.flatMap((id) =>
      getDailyPopulationSnapshots(
        snapshots.filter((s) => s.population === id),
      ).map((s) => this.toApiInterface(s)),
    );
  }

  protected toApiInterface(
    doc: PopulationSnapshotInterface,
  ): ApiPopulationSnapshot {
    return toApiPopulationSnapshot(doc);
  }
}

export function toApiPopulationSnapshot(
  doc: PopulationSnapshotInterface,
): ApiPopulationSnapshot {
  return {
    id: doc.id,
    dateCreated: doc.dateCreated.toISOString(),
    dateUpdated: doc.dateUpdated.toISOString(),
    population: doc.population,
    userIdType: doc.userIdType,
    asOf: doc.asOf.toISOString(),
    comparisonDays: doc.comparisonDays,
    status: doc.status,
    error: doc.error ?? "",
    result: doc.result,
  };
}
