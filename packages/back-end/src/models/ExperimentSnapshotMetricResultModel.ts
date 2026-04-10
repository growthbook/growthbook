import { FilterQuery } from "mongoose";
import type { ExperimentSnapshotMetricResultInterface } from "shared/types/experiment-snapshot";
import { experimentSnapshotMetricResultValidator } from "shared/validators";
import { promiseAllChunks } from "back-end/src/util/promise";
import { Context, MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: experimentSnapshotMetricResultValidator,
  collectionName: "experimentsnapshotmetricresults",
  idPrefix: "esmr_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        snapshotId: 1,
        analysisIndex: 1,
        metricId: 1,
        dimensionName: 1,
      },
      unique: true,
    },
    {
      fields: {
        organization: 1,
        parentMetricId: 1,
        snapshotId: 1,
        analysisIndex: 1,
      },
    },
  ],
});

export class ExperimentSnapshotMetricResultModel extends BaseClass {
  protected canRead() {
    return true;
  }
  protected canCreate() {
    return true;
  }
  protected canUpdate() {
    return true;
  }
  protected canDelete() {
    return true;
  }

  public async deleteForSnapshot(snapshotId: string): Promise<void> {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      snapshotId,
    });
  }

  public async deleteForAnalysis(
    snapshotId: string,
    analysisIndex: number,
  ): Promise<void> {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      snapshotId,
      analysisIndex,
    });
  }

  // TODO: Replace per-row this.create() with a bulk insertMany for better
  // write throughput.  Large snapshots can produce hundreds of metric rows,
  // and individual round-trips become a bottleneck.
  public async insertRows(
    rows: Omit<ExperimentSnapshotMetricResultInterface, "id">[],
  ): Promise<void> {
    if (!rows.length) return;
    await promiseAllChunks(
      rows.map((row) => async () => {
        await this.create(row);
      }),
      10,
    );
  }

  public async findForAnalysis(
    snapshotId: string,
    analysisIndex: number,
  ): Promise<ExperimentSnapshotMetricResultInterface[]> {
    return (await this._find(
      {
        snapshotId,
        analysisIndex,
      },
      {
        sort: { dimensionValue: 1, metricId: 1 },
      },
    )) as ExperimentSnapshotMetricResultInterface[];
  }

  public async queryRows({
    snapshotId,
    analysisIndex,
    metricIds,
    dimensionNames,
    parentMetricId,
  }: {
    snapshotId: string;
    analysisIndex: number;
    metricIds?: string[];
    dimensionNames?: string[];
    parentMetricId?: string;
  }): Promise<ExperimentSnapshotMetricResultInterface[]> {
    const filter: FilterQuery<ExperimentSnapshotMetricResultInterface> & {
      metricId?: { $in: string[] };
      dimensionName?: { $in: string[] };
    } = {
      snapshotId,
      analysisIndex,
    };
    if (parentMetricId) filter.parentMetricId = parentMetricId;
    if (metricIds?.length) filter.metricId = { $in: metricIds };
    if (dimensionNames?.length) filter.dimensionName = { $in: dimensionNames };

    return (await this._find(filter, {
      sort: { dimensionValue: 1, metricId: 1 },
    })) as ExperimentSnapshotMetricResultInterface[];
  }
}

function scopedModel(
  organization: string,
): ExperimentSnapshotMetricResultModel {
  return new ExperimentSnapshotMetricResultModel({
    org: { id: organization },
  } as unknown as Context);
}

export async function deleteExperimentSnapshotMetricResultsForSnapshot(
  organization: string,
  snapshotId: string,
): Promise<void> {
  await scopedModel(organization).deleteForSnapshot(snapshotId);
}

export async function deleteExperimentSnapshotMetricResultsForAnalysis(
  organization: string,
  snapshotId: string,
  analysisIndex: number,
): Promise<void> {
  await scopedModel(organization).deleteForAnalysis(snapshotId, analysisIndex);
}

export async function insertExperimentSnapshotMetricResults(
  rows: Omit<ExperimentSnapshotMetricResultInterface, "id">[],
): Promise<void> {
  if (!rows.length) return;
  await scopedModel(rows[0].organization).insertRows(rows);
}

export async function findExperimentSnapshotMetricResultsForAnalysis({
  organization,
  snapshotId,
  analysisIndex,
}: {
  organization: string;
  snapshotId: string;
  analysisIndex: number;
}): Promise<ExperimentSnapshotMetricResultInterface[]> {
  return scopedModel(organization).findForAnalysis(snapshotId, analysisIndex);
}

export async function queryExperimentSnapshotMetricResults({
  organization,
  snapshotId,
  analysisIndex,
  metricIds,
  dimensionNames,
  parentMetricId,
}: {
  organization: string;
  snapshotId: string;
  analysisIndex: number;
  metricIds?: string[];
  dimensionNames?: string[];
  parentMetricId?: string;
}): Promise<ExperimentSnapshotMetricResultInterface[]> {
  return scopedModel(organization).queryRows({
    snapshotId,
    analysisIndex,
    metricIds,
    dimensionNames,
    parentMetricId,
  });
}
