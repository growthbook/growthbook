import {
  encodeSnapshotAnalysisChunks,
  decodeSnapshotAnalysisChunks,
  buildMetricOrdering,
  getChunkedAnalysesMetaFromSnapshot,
  AnalysisMetaEntry,
} from "shared/snapshot-analysis-chunks";
import {
  experimentSnapshotAnalysisChunkValidator,
  ExperimentSnapshotAnalysisChunkInterface,
  validateExperimentSnapshotAnalysisChunkColumnLengths,
} from "shared/validators";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import { MakeModelClass, waitForIndexes } from "./BaseModel";

type ChunkWriteResult = {
  chunkedAnalysesMeta: AnalysisMetaEntry[];
  metricIds: string[];
};

const BaseClass = MakeModelClass({
  schema: experimentSnapshotAnalysisChunkValidator,
  collectionName: "experimentsnapshotanalysischunks",
  idPrefix: "snpac_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        snapshotId: 1,
        metricId: 1,
      },
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

export class ExperimentSnapshotAnalysisChunkModel extends BaseClass {
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
    doc: ExperimentSnapshotAnalysisChunkInterface,
  ) {
    validateExperimentSnapshotAnalysisChunkColumnLengths(doc);
  }

  /**
   * Encode snapshot analyses and write one document per metric.
   * Returns chunkedAnalysesMeta for storage on the main snapshot document.
   */
  public async createFromAnalyses({
    snapshotId,
    experimentId,
    analyses,
    settings,
  }: {
    snapshotId: string;
    experimentId: string;
    analyses: ExperimentSnapshotAnalysis[];
    settings: ExperimentSnapshotSettings;
  }): Promise<ChunkWriteResult> {
    if (
      analyses.length === 0 ||
      analyses.every((analysis) => analysis.results.length === 0)
    ) {
      // Analyses without result rows have no chunk data or metadata to persist.
      return { chunkedAnalysesMeta: [], metricIds: [] };
    }

    const metricOrdering = getMetricOrdering(settings);
    const { metricChunks, chunkedAnalysesMeta } = encodeSnapshotAnalysisChunks(
      analyses,
      metricOrdering,
    );
    const entries = Array.from(metricChunks.entries());
    const metricIds = entries.map(([metricId]) => metricId);
    await waitForIndexes();

    if (entries.length) {
      const now = new Date();
      await this.bulkWrite(
        entries.map(([metricId, chunk]) => {
          validateExperimentSnapshotAnalysisChunkColumnLengths(chunk);

          return {
            updateOne: {
              filter: {
                snapshotId,
                metricId,
              },
              update: {
                $set: {
                  experimentId,
                  numRows: chunk.numRows,
                  data: chunk.data,
                  dateUpdated: now,
                },
                $setOnInsert: {
                  id: this._generateId(),
                  dateCreated: now,
                },
              },
              upsert: true,
            },
          };
        }),
      );

      await this._dangerousGetCollection().deleteMany({
        organization: this.context.org.id,
        snapshotId,
        metricId: { $nin: metricIds },
      });
    }

    return { chunkedAnalysesMeta, metricIds };
  }

  /**
   * Get all chunks for a snapshot.
   * @internal
   */
  public async getAllChunksForSnapshot(snapshotId: string) {
    return this._find({ snapshotId });
  }

  /**
   * Populate snapshot analyses results from chunks.
   * Mutates the snapshot objects in place.
   */
  public async populateChunkedAnalyses(
    snapshots: ExperimentSnapshotInterface[],
    metricIds?: string[],
  ) {
    const chunkedSnapshots = snapshots.filter((s) => s.hasChunkedAnalyses);
    if (!chunkedSnapshots.length) return;

    const query: Record<string, unknown> = {
      snapshotId: { $in: chunkedSnapshots.map((snapshot) => snapshot.id) },
    };
    if (metricIds?.length) {
      query.metricId = { $in: metricIds };
    }

    const allChunks = await this._find(query);

    // Group chunks by snapshot ID
    const chunksBySnapshotId = new Map<
      string,
      ExperimentSnapshotAnalysisChunkInterface[]
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
      const chunks = chunksBySnapshotId.get(snapshot.id) ?? [];
      if (!chunks.length && !snapshot.chunkedAnalysesMeta?.length) continue;

      const { chunkedAnalysesMeta, analysisMetadata } =
        getChunkedAnalysesMetaFromSnapshot(snapshot);

      const decoded = decodeSnapshotAnalysisChunks(
        chunks,
        chunkedAnalysesMeta,
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
