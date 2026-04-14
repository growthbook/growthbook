import {
  encodeSnapshotResults,
  decodeSnapshotResults,
  buildMetricOrdering,
  getAnalysisMetaFromSnapshot,
  AnalysisMetaEntry,
} from "shared/snapshot-results";
import {
  experimentSnapshotResultChunkValidator,
  ExperimentSnapshotResultChunkInterface,
  validateExperimentSnapshotResultChunkColumnLengths,
} from "shared/validators";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import { promiseAllChunks } from "back-end/src/util/promise";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: experimentSnapshotResultChunkValidator,
  collectionName: "experimentsnapshotresultchunks",
  idPrefix: "snpres_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: { organization: 1, snapshotId: 1, metricId: 1 },
      unique: true,
    },
  ],
});

function getMetricOrdering(settings: ExperimentSnapshotSettings): string[] {
  return buildMetricOrdering(
    settings.goalMetrics,
    settings.secondaryMetrics,
    settings.guardrailMetrics,
  );
}

export class ExperimentSnapshotResultChunkModel extends BaseClass {
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

  protected async customValidation(
    doc: ExperimentSnapshotResultChunkInterface,
  ) {
    validateExperimentSnapshotResultChunkColumnLengths(doc);
  }

  /**
   * Encode snapshot analyses and write one document per metric.
   * Returns analysisMeta for storage on the main snapshot document.
   */
  public async createFromAnalyses(
    snapshotId: string,
    analyses: ExperimentSnapshotAnalysis[],
    settings: ExperimentSnapshotSettings,
  ): Promise<AnalysisMetaEntry[]> {
    const metricOrdering = getMetricOrdering(settings);
    const { metricChunks, analysisMeta } = encodeSnapshotResults(
      analyses,
      metricOrdering,
    );

    const experimentId = settings.experimentId;
    const entries = Array.from(metricChunks.entries());
    await promiseAllChunks(
      entries.map(([metricId, chunk]) => async () => {
        await this.create({
          snapshotId,
          experimentId,
          metricId,
          ...chunk,
        });
      }),
      10,
    );

    return analysisMeta;
  }

  /**
   * Get all chunks for a snapshot.
   */
  public async getAllChunksForSnapshot(snapshotId: string) {
    return this._find({ snapshotId });
  }

  /**
   * Get only chunks for the requested metric IDs.
   */
  public async getChunksForMetrics(snapshotId: string, metricIds: string[]) {
    return this._find({ snapshotId, metricId: { $in: metricIds } });
  }

  /**
   * Populate snapshot analyses results from chunks.
   * Mutates the snapshot objects in place.
   */
  public async populateSnapshots(
    snapshots: ExperimentSnapshotInterface[],
    metricIds?: string[],
  ) {
    const chunkedSnapshots = snapshots.filter((s) => s.hasChunkedResults);
    if (!chunkedSnapshots.length) return;

    const snapshotIds = chunkedSnapshots.map((s) => s.id);

    let allChunks: ExperimentSnapshotResultChunkInterface[];
    if (metricIds?.length) {
      allChunks = await this._find({
        snapshotId: { $in: snapshotIds },
        metricId: { $in: metricIds },
      });
    } else {
      allChunks = await this._find({
        snapshotId: { $in: snapshotIds },
      });
    }

    // Group chunks by snapshot ID
    const chunksBySnapshotId = new Map<
      string,
      ExperimentSnapshotResultChunkInterface[]
    >();
    for (const chunk of allChunks) {
      if (!chunksBySnapshotId.has(chunk.snapshotId)) {
        chunksBySnapshotId.set(chunk.snapshotId, []);
      }
      chunksBySnapshotId.get(chunk.snapshotId)!.push(chunk);
    }

    // Decode and populate each snapshot
    const filterMetricIds = metricIds ? new Set(metricIds) : undefined;
    for (const snapshot of chunkedSnapshots) {
      const chunks = chunksBySnapshotId.get(snapshot.id);
      if (!chunks?.length) continue;

      const { analysisMeta, analysisMetadata } =
        getAnalysisMetaFromSnapshot(snapshot);

      const decoded = decodeSnapshotResults(
        chunks,
        analysisMeta,
        analysisMetadata,
        filterMetricIds,
      );

      // Merge decoded results into snapshot analyses
      for (let i = 0; i < decoded.length; i++) {
        if (snapshot.analyses[i]) {
          snapshot.analyses[i].results = decoded[i].results;
        }
      }
    }
  }

  /**
   * Delete all chunks for a single snapshot.
   */
  public async deleteBySnapshotId(snapshotId: string) {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      snapshotId,
    });
  }

  /**
   * Delete all chunks for multiple snapshots.
   */
  public async deleteBySnapshotIds(snapshotIds: string[]) {
    if (!snapshotIds.length) return;
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      snapshotId: { $in: snapshotIds },
    });
  }
}
