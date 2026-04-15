import isEqual from "lodash/isEqual";
import {
  encodeSnapshotResults,
  decodeSnapshotResults,
  buildMetricOrdering,
  getChunkedAnalysesMetaFromSnapshot,
  AnalysisMetaEntry,
} from "shared/snapshot-results";
import {
  experimentSnapshotAnalysisChunkValidator,
  ExperimentSnapshotAnalysisChunkInterface,
  validateExperimentSnapshotAnalysisChunkColumnLengths,
} from "shared/validators";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
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
  idPrefix: "snpana_",
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

function deepEqualSettings(
  a: ExperimentSnapshotAnalysisSettings,
  b: ExperimentSnapshotAnalysisSettings,
): boolean {
  return isEqual(a, b);
}

function mergeAnalysis(
  analyses: ExperimentSnapshotAnalysis[],
  newAnalysis: ExperimentSnapshotAnalysis,
): ExperimentSnapshotAnalysis[] {
  let replaced = false;
  const merged = analyses.map((analysis) => {
    if (!deepEqualSettings(analysis.settings, newAnalysis.settings)) {
      return analysis;
    }
    replaced = true;
    return newAnalysis;
  });

  return replaced ? merged : [...merged, newAnalysis];
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
  public async createFromAnalyses(
    snapshotId: string,
    analyses: ExperimentSnapshotAnalysis[],
    settings: ExperimentSnapshotSettings,
  ): Promise<ChunkWriteResult> {
    if (
      analyses.length === 0 ||
      analyses.every((analysis) => analysis.results.length === 0)
    ) {
      // TODO: Check if this is correct or if we need to do something else
      return { chunkedAnalysesMeta: [], metricIds: [] };
    }

    const metricOrdering = getMetricOrdering(settings);
    const { metricChunks, chunkedAnalysesMeta } = encodeSnapshotResults(
      analyses,
      metricOrdering,
    );

    const experimentId = settings.experimentId;
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

      const decoded = decodeSnapshotResults(
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
   * Replace all chunks for a snapshot, merging in a new/updated analysis.
   * Returns the new chunkedAnalysesMeta for storage on the snapshot document.
   */
  public async rebuildChunksWithAnalysis(
    snapshot: ExperimentSnapshotInterface,
    newAnalysis: ExperimentSnapshotAnalysis,
  ): Promise<ChunkWriteResult | null> {
    const existingAnalysisIndex = snapshot.analyses.findIndex((analysis) =>
      deepEqualSettings(analysis.settings, newAnalysis.settings),
    );
    const newAnalysisHasResults = newAnalysis.results.length > 0;
    const existingAnalysisHasStoredResults =
      existingAnalysisIndex >= 0 &&
      (snapshot.chunkedAnalysesMeta?.[existingAnalysisIndex]?.dimensions
        .length ?? 0) > 0;

    if (!newAnalysisHasResults && !existingAnalysisHasStoredResults) {
      return null;
    }

    await this.populateChunkedAnalyses([snapshot]);
    const mergedAnalyses = mergeAnalysis(snapshot.analyses, newAnalysis);
    return this.createFromAnalyses(
      snapshot.id,
      mergedAnalyses,
      snapshot.settings,
    );
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
