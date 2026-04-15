import isEqual from "lodash/isEqual";
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
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import { promiseAllChunks } from "back-end/src/util/promise";
import { MakeModelClass, waitForIndexes } from "./BaseModel";

type ChunkWriteResult = {
  analysisMeta: AnalysisMetaEntry[];
  resultChunkVersion: string;
};

const BaseClass = MakeModelClass({
  schema: experimentSnapshotResultChunkValidator,
  collectionName: "experimentsnapshotresultchunks",
  idPrefix: "snpres_",
  globallyUniquePrimaryKeys: true,
  indexesToRemove: ["organization_1_snapshotId_1_metricId_1"],
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        snapshotId: 1,
        resultChunkVersion: 1,
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
  ): Promise<ChunkWriteResult> {
    const resultChunkVersion = this._generateUid();
    const metricOrdering = getMetricOrdering(settings);
    const { metricChunks, analysisMeta } = encodeSnapshotResults(
      analyses,
      metricOrdering,
    );

    const experimentId = settings.experimentId;
    const entries = Array.from(metricChunks.entries());
    await waitForIndexes();
    try {
      await promiseAllChunks(
        entries.map(([metricId, chunk]) => async () => {
          await this.create({
            snapshotId,
            experimentId,
            metricId,
            resultChunkVersion,
            ...chunk,
          });
        }),
        10,
      );
    } catch (e) {
      // Clean up any partially-written chunks from this version
      await this._dangerousGetCollection().deleteMany({
        organization: this.context.org.id,
        snapshotId,
        resultChunkVersion,
      });
      throw e;
    }

    return { analysisMeta, resultChunkVersion };
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
  public async populateChunkedResults(
    snapshots: ExperimentSnapshotInterface[],
    metricIds?: string[],
  ) {
    const chunkedSnapshots = snapshots.filter((s) => s.hasChunkedResults);
    if (!chunkedSnapshots.length) return;

    const chunkFilters: Record<string, unknown>[] = [];
    const legacySnapshotIds: string[] = [];
    for (const snapshot of chunkedSnapshots) {
      if (snapshot.resultChunkVersion) {
        chunkFilters.push({
          snapshotId: snapshot.id,
          resultChunkVersion: snapshot.resultChunkVersion,
        });
      } else {
        legacySnapshotIds.push(snapshot.id);
      }
    }
    if (legacySnapshotIds.length) {
      chunkFilters.push({
        snapshotId: { $in: legacySnapshotIds },
        resultChunkVersion: { $exists: false },
      });
    }

    const query: Record<string, unknown> =
      chunkFilters.length === 1 ? chunkFilters[0] : { $or: chunkFilters };
    if (metricIds?.length) {
      query.metricId = { $in: metricIds };
    }

    const allChunks = await this._find(query);

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
      const chunks = chunksBySnapshotId.get(snapshot.id) ?? [];
      if (!chunks.length && !snapshot.analysisMeta?.length) continue;

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
   * Replace all chunks for a snapshot, merging in a new/updated analysis.
   * Returns the new analysisMeta for storage on the snapshot document.
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
      (snapshot.analysisMeta?.[existingAnalysisIndex]?.dimensions.length ?? 0) >
        0;

    if (!newAnalysisHasResults && !existingAnalysisHasStoredResults) {
      return null;
    }

    await this.populateChunkedResults([snapshot]);
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

  /**
   * Remove chunk generations that are no longer referenced by the snapshot.
   */
  public async deleteOldVersions(
    snapshotId: string,
    activeResultChunkVersion: string,
  ) {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      snapshotId,
      resultChunkVersion: { $ne: activeResultChunkVersion },
    });
  }
}
