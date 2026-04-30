import {
  encodeSnapshotAnalysisChunks,
  decodeSnapshotAnalysisChunks,
  buildMetricOrdering,
  migrateLegacySnapshotAnalysisChunkData,
  remapChunkDataPositionKeysToAnalysisKeys,
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

  // Phase 1 of the legacy chunk migration: rewrite the flat
  // `{numRows, data:{a,d,v,...}}` shape into per-position records
  // (`{ "0": {...}, "1": {...} }`). Keying by position keeps this
  // migration self-contained — the position→`analysisKey` rename
  // requires the parent snapshot and runs in `populateChunkedAnalyses`
  // (phase 2). Idempotent on already-normalized docs.
  protected migrate(
    legacyDoc: unknown,
  ): ExperimentSnapshotAnalysisChunkInterface {
    const doc = { ...(legacyDoc as Record<string, unknown>) };
    const { data } = migrateLegacySnapshotAnalysisChunkData(
      doc as { data?: unknown; numRows?: unknown },
    );
    doc.data = data;
    // Top-level `numRows` is a legacy-only field; the strict validator
    // doesn't include it. Strip so reads don't carry stale state.
    delete doc.numRows;
    return doc as unknown as ExperimentSnapshotAnalysisChunkInterface;
  }

  protected async customValidation(
    doc: ExperimentSnapshotAnalysisChunkInterface,
  ) {
    this.validateWriteData(doc.data);
  }

  // Single choke point for write-path validation. BaseModel wires
  // `customValidation` into create/update, but `writeAnalyses` issues
  // `bulkWrite` directly and bypasses that hook — so every write path
  // must delegate here. Keeping the helper on the model class makes it
  // obvious where to plug new writers in.
  private validateWriteData(
    data: Record<string, { numRows: number } & Record<string, unknown>>,
  ) {
    validateExperimentSnapshotAnalysisChunkColumnLengths({ data });
  }

  /**
   * Write a set of analyses' sub-paths onto the snapshot's metric chunk
   * docs. Encoding is always per-analysis (`data.<analysisKey>`); the
   * `scope` parameter controls how authoritative the passed set is over
   * what's already on disk.
   *
   * - `scope: "all"` — the passed `analyses` are the complete set for the
   *   snapshot. For each metric chunk: any key in the passed set with no
   *   rows for that metric has its sub-path unset; chunks for metrics no
   *   longer in the set are deleted. Use when rebuilding a snapshot
   *   wholesale (creation, `updateSnapshot({ analyses })`).
   *
   * - `scope: "keys"` — only the passed analyses' sub-paths are
   *   authoritative; other analyses on the snapshot are untouched. For
   *   each passed key, sub-paths on metrics that dropped out of its new
   *   result set are unset (scoped to that key's field). Race-safe
   *   against concurrent writes to other analyses because every write
   *   targets only `data.<passedKey>`. Use for single-analysis
   *   add-or-update via {@link upsertAnalysis}.
   *
   * Ordering is always upsert-then-prune so readers never observe a key
   * in `chunkedAnalysesMeta` whose chunk sub-paths have been wiped (the
   * inverse would create a visibility window of ghost-empty results).
   */
  public async writeAnalyses({
    snapshotId,
    experimentId,
    analyses,
    settings,
    scope,
  }: {
    snapshotId: string;
    experimentId: string;
    analyses: ExperimentSnapshotAnalysis[];
    settings: ExperimentSnapshotSettings;
    scope: "all" | "keys";
  }): Promise<{
    chunkedAnalysesMeta: Record<string, AnalysisMetaEntry>;
    metricIds: string[];
  }> {
    // For "all", no analyses or no results means nothing to persist and
    // nothing to clean up (snapshot creation path). For "keys", an empty
    // or empty-results analysis still needs its sub-path cleared on disk,
    // so only short-circuit on a truly empty input list.
    if (
      analyses.length === 0 ||
      (scope === "all" &&
        analyses.every((analysis) => analysis.results.length === 0))
    ) {
      return { chunkedAnalysesMeta: {}, metricIds: [] };
    }

    const metricOrdering = getMetricOrdering(settings);
    const { metricChunks, chunkedAnalysesMeta } = encodeSnapshotAnalysisChunks(
      analyses,
      metricOrdering,
    );
    const analysisKeys = analyses.map((a) => a.analysisKey);
    const entries = Array.from(metricChunks.entries());
    const metricIds = entries.map(([metricId]) => metricId);

    // Per-key "keep" metric set. Used by the scope:"keys" prune below to
    // unset a key's sub-path on chunks where it used to contribute rows
    // but no longer does.
    const metricIdsByKey = new Map<string, string[]>(
      analysisKeys.map((key) => [key, []]),
    );
    for (const [metricId, perMetricData] of entries) {
      for (const key of analysisKeys) {
        if (perMetricData[key]) metricIdsByKey.get(key)!.push(metricId);
      }
    }

    await waitForIndexes();

    // 1. Upsert. For scope:"all" we inline-unset keys in the passed set
    //    that are absent from a given metric chunk. For scope:"keys" the
    //    stale-unset is a separate post-pass (step 2 below) because we
    //    don't know up-front which chunks previously carried the key.
    // Track whether step 1 issued any `$unset` — only those can leave a
    // chunk's `data` empty, and only then does step 3's sweep have work.
    let hadInlineUnsets = false;
    if (entries.length) {
      const now = new Date();
      await this.bulkWrite(
        entries.map(([metricId, perMetricData]) => {
          this.validateWriteData(perMetricData);

          const setOps: Record<string, unknown> = {
            experimentId,
            dateUpdated: now,
          };
          const unsetOps: Record<string, ""> = {};
          for (const key of analysisKeys) {
            const perAnalysis = perMetricData[key];
            if (perAnalysis) {
              setOps[`data.${key}`] = perAnalysis;
            } else if (scope === "all") {
              unsetOps[`data.${key}`] = "";
            }
          }

          const hasUnsets = Object.keys(unsetOps).length > 0;
          if (hasUnsets) hadInlineUnsets = true;

          const update: Record<string, unknown> = {
            $set: setOps,
            $setOnInsert: {
              id: this._generateId(),
              dateCreated: now,
            },
            ...(hasUnsets ? { $unset: unsetOps } : {}),
          };

          return {
            updateOne: {
              filter: { snapshotId, metricId },
              update,
              upsert: true,
            },
          };
        }),
      );
    }

    // 2. Prune stale state per scope.
    const coll = this._dangerousGetCollection();
    const organization = this.context.org.id;

    let anyPruneUnsetModified = false;
    if (scope === "all") {
      // Chunks for metrics that dropped out of the snapshot entirely.
      // This deletes whole chunks (never leaves `data: {}` behind), so
      // it doesn't contribute to the step-3 sweep decision.
      await coll.deleteMany({
        organization,
        snapshotId,
        metricId: { $nin: metricIds },
      });
    } else {
      // For each passed key, drop `data.<key>` from chunks where it
      // previously contributed rows but doesn't now. `$nin: []` matches
      // every chunk, which correctly covers the empty-results case
      // (clear the key everywhere). Each unset targets a disjoint
      // sub-path per key, so parallel dispatch is safe.
      const pruneResults = await Promise.all(
        analysisKeys.map((key) =>
          coll.updateMany(
            {
              organization,
              snapshotId,
              metricId: { $nin: metricIdsByKey.get(key) ?? [] },
              [`data.${key}`]: { $exists: true },
            },
            { $unset: { [`data.${key}`]: "" } },
          ),
        ),
      );
      anyPruneUnsetModified = pruneResults.some((r) => r.modifiedCount > 0);
    }

    // 3. Shared sweep: drop chunk docs whose `data` became empty as a
    //    result of unsets in steps 1 or 2. Skip when no unset could
    //    possibly have emptied a chunk — at steady state every
    //    `upsertAnalysis` call hits this path, so the saved round-trip
    //    is meaningful under fan-out.
    if (hadInlineUnsets || anyPruneUnsetModified) {
      await coll.deleteMany({
        organization,
        snapshotId,
        $or: [{ data: {} }, { data: { $exists: false } }],
      });
    }

    return { chunkedAnalysesMeta, metricIds };
  }

  /**
   * Convenience wrapper for single-analysis writes. Delegates to
   * {@link writeAnalyses} with `scope: "keys"` and returns the meta entry
   * for the passed analysis (the shape callers have always consumed).
   */
  public async upsertAnalysis({
    snapshotId,
    experimentId,
    analysis,
    settings,
  }: {
    snapshotId: string;
    experimentId: string;
    analysis: ExperimentSnapshotAnalysis;
    settings: ExperimentSnapshotSettings;
  }): Promise<{ metaEntry: AnalysisMetaEntry; metricIds: string[] }> {
    const { chunkedAnalysesMeta, metricIds } = await this.writeAnalyses({
      snapshotId,
      experimentId,
      analyses: [analysis],
      settings,
      scope: "keys",
    });
    const metaEntry = chunkedAnalysesMeta[analysis.analysisKey] ?? {
      dimensions: [],
    };
    return { metaEntry, metricIds };
  }

  /**
   * Remove a single analysis's sub-path from every chunk for the snapshot.
   * Used when a write path needs to roll back its own minted key — e.g.,
   * when `addOrUpdateSnapshotAnalysis` loses a same-settings race and has
   * to clean up the speculative `data.<mintedKey>` it wrote before
   * delegating to the update path.
   */
  public async removeAnalysisChunks(snapshotId: string, analysisKey: string) {
    await this._dangerousGetCollection().updateMany(
      {
        organization: this.context.org.id,
        snapshotId,
        [`data.${analysisKey}`]: { $exists: true },
      },
      { $unset: { [`data.${analysisKey}`]: "" } },
    );
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      snapshotId,
      $or: [{ data: {} }, { data: { $exists: false } }],
    });
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
    // A snapshot "has chunks" if EITHER the stored `hasChunkedAnalyses`
    // flag or its `chunkedAnalysesMeta` record says so. The flag alone is
    // unreliable: a single-analysis writer can flip it to `false` based on
    // a stale read taken before a concurrent writer populated another
    // analysis. The meta unset in that write is scoped per-key so
    // surviving meta entries remain on disk — checking them here ensures
    // populated data is never hidden by a stale flag.
    const chunkedSnapshots = snapshots.filter(
      (s) =>
        s.hasChunkedAnalyses ||
        (!!s.chunkedAnalysesMeta &&
          Object.keys(s.chunkedAnalysesMeta).length > 0),
    );
    if (!chunkedSnapshots.length) return;

    const query: Record<string, unknown> = {
      snapshotId: { $in: chunkedSnapshots.map((snapshot) => snapshot.id) },
    };
    if (metricIds?.length) {
      query.metricId = { $in: metricIds };
    }

    const allChunks = await this._find(query);

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

    const filterMetricIds = metricIds ? new Set(metricIds) : undefined;
    for (const snapshot of chunkedSnapshots) {
      const chunks = chunksBySnapshotId.get(snapshot.id) ?? [];
      const metaHasEntries =
        !!snapshot.chunkedAnalysesMeta &&
        Object.keys(snapshot.chunkedAnalysesMeta).length > 0;
      if (!chunks.length && !metaHasEntries) continue;

      // Phase 2 of the chunk migration: chunks come out of `_find` with
      // shape already normalized by `migrate()` above (phase 1), so
      // either keyed by `analysisKey` (post-refactor docs) or by
      // numeric position (legacy docs). Rename positions to
      // `analysisKey`s using the snapshot's own ordering — this is the
      // only place we have both pieces of context. Idempotent on
      // already-renamed data.
      const analysisKeysByPosition = snapshot.analyses.map(
        (a) => a.analysisKey,
      );
      const decodableChunks = chunks.map((chunk) => ({
        metricId: chunk.metricId,
        data: remapChunkDataPositionKeysToAnalysisKeys(
          chunk.data,
          analysisKeysByPosition,
        ),
      }));

      const decoded = decodeSnapshotAnalysisChunks(
        decodableChunks,
        snapshot.chunkedAnalysesMeta ?? {},
        snapshot.analyses.map((a) => ({
          analysisKey: a.analysisKey,
          settings: a.settings,
          dateCreated: a.dateCreated,
          status: a.status,
          ...(a.error ? { error: a.error } : {}),
        })),
        filterMetricIds,
      );

      const chunkedAnalysesMeta = snapshot.chunkedAnalysesMeta ?? {};
      const chunkDataKeys = new Set<string>();
      for (const chunk of decodableChunks) {
        for (const key of Object.keys(chunk.data)) {
          chunkDataKeys.add(key);
        }
      }

      // `decoded` mirrors the order of `snapshot.analyses` (we built
      // `analysisMetadata` from it above). Positional mapping back is safe.
      // Preserve inline results on legacy snapshots that were partially
      // transitioned to chunked storage: only analyses that actually have
      // chunk/meta state should be overwritten from decoded chunk data.
      for (let i = 0; i < decoded.length; i++) {
        const analysis = snapshot.analyses[i];
        if (
          analysis &&
          (chunkedAnalysesMeta[analysis.analysisKey] ||
            chunkDataKeys.has(analysis.analysisKey))
        ) {
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
