import mongoose from "mongoose";
import {
  encodeSnapshotResults,
  decodeSnapshotResults,
  buildMetricOrdering,
} from "shared/snapshot-results";
import {
  snapshotResultChunkValidator,
  SnapshotResultChunkInterface,
} from "shared/validators";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import { promiseAllChunks } from "back-end/src/util/promise";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: snapshotResultChunkValidator,
  collectionName: "snapshotresultchunks",
  idPrefix: "snpres_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: { organization: 1, snapshotId: 1, chunkNumber: 1 },
      unique: true,
    },
    { fields: { organization: 1, snapshotId: 1, metricIds: 1 } },
  ],
});

function getMetricOrdering(settings: ExperimentSnapshotSettings): string[] {
  return buildMetricOrdering(
    settings.goalMetrics,
    settings.secondaryMetrics,
    settings.guardrailMetrics,
  );
}

export class SnapshotResultChunkModel extends BaseClass {
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

  /**
   * Encode snapshot analyses and write them as chunks.
   */
  public async createFromAnalyses(
    snapshotId: string,
    analyses: ExperimentSnapshotAnalysis[],
    settings: ExperimentSnapshotSettings,
  ) {
    const metricOrdering = getMetricOrdering(settings);
    const { chunks, metricIdsByChunk } = encodeSnapshotResults(
      analyses,
      metricOrdering,
    );

    await promiseAllChunks(
      chunks.map((chunk, i) => async () => {
        await this.create({
          snapshotId,
          chunkNumber: i,
          metricIds: metricIdsByChunk[i],
          ...chunk,
        });
      }),
      3,
    );
  }

  /**
   * Get all chunks for a snapshot, sorted by chunkNumber.
   */
  public async getAllChunksForSnapshot(snapshotId: string) {
    return this._find({ snapshotId }, { sort: { chunkNumber: 1 } });
  }

  /**
   * Get only chunks that contain any of the requested metric IDs.
   */
  public async getChunksForMetrics(snapshotId: string, metricIds: string[]) {
    return this._find(
      { snapshotId, metricIds: { $in: metricIds } },
      { sort: { chunkNumber: 1 } },
    );
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

    let allChunks: SnapshotResultChunkInterface[];
    if (metricIds?.length) {
      allChunks = await this._find(
        {
          snapshotId: { $in: snapshotIds },
          metricIds: { $in: metricIds },
        },
        { sort: { snapshotId: 1, chunkNumber: 1 } },
      );
    } else {
      allChunks = await this._find(
        { snapshotId: { $in: snapshotIds } },
        { sort: { snapshotId: 1, chunkNumber: 1 } },
      );
    }

    // Group chunks by snapshot ID
    const chunksBySnapshotId = new Map<
      string,
      SnapshotResultChunkInterface[]
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

      const analysisMetadata = snapshot.analyses.map((a) => ({
        settings: a.settings,
        dateCreated: a.dateCreated,
        status: a.status,
        error: a.error,
      }));

      const decoded = decodeSnapshotResults(
        chunks,
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

  /**
   * Delete chunks outside of org context (e.g., phase deletion).
   */
  public static async dangerousDeleteBySnapshotIds(
    organization: string,
    snapshotIds: string[],
  ) {
    if (!snapshotIds.length) return;
    const collection = mongoose.connection.db.collection(
      "snapshotresultchunks",
    );
    await collection.deleteMany({
      organization,
      snapshotId: { $in: snapshotIds },
    });
  }
}
