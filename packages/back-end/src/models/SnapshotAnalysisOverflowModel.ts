import { snapshotAnalysisOverflowValidator } from "shared/validators";
import { ExperimentSnapshotAnalysis } from "shared/types/experiment-snapshot";
import {
  chunkString,
  OVERFLOW_CHUNK_SIZE_CHARS,
} from "back-end/src/util/overflow";
import { promiseAllChunks } from "back-end/src/util/promise";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: snapshotAnalysisOverflowValidator,
  collectionName: "snapshotanalysisoverflow",
  idPrefix: "sao_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    { fields: { organization: 1, snapshot: 1, chunkIndex: 1 }, unique: true },
  ],
});

// JSON serialization turns Date instances into ISO strings; restore the Date
// fields that ExperimentSnapshotAnalysis declares so downstream `.getTime()`
// etc. don't crash.
function reviveAnalysisDates(
  a: ExperimentSnapshotAnalysis,
): ExperimentSnapshotAnalysis {
  const settings = a.settings.holdoutAnalysisWindow
    ? {
        ...a.settings,
        holdoutAnalysisWindow: {
          start: new Date(a.settings.holdoutAnalysisWindow.start),
          end: new Date(a.settings.holdoutAnalysisWindow.end),
        },
      }
    : a.settings;
  return { ...a, dateCreated: new Date(a.dateCreated), settings };
}

function parseAnalyses(serialized: string): ExperimentSnapshotAnalysis[] {
  const parsed: ExperimentSnapshotAnalysis[] = JSON.parse(serialized);
  return parsed.map(reviveAnalysisDates);
}

// Overflow storage for ExperimentSnapshot.analyses when the serialized analyses
// would push the snapshot document past the 16MB BSON limit. The analyses array
// is JSON-serialized and split across multiple chunk documents; concatenating
// chunk `data` in chunkIndex order yields the original JSON.
export class SnapshotAnalysisOverflowModel extends BaseClass {
  // Access is gated by the parent snapshot, not by these derived chunk docs.
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

  public async replaceForSnapshot(
    snapshotId: string,
    analyses: ExperimentSnapshotAnalysis[],
  ): Promise<void> {
    await this.replaceForSnapshotSerialized(
      snapshotId,
      JSON.stringify(analyses),
    );
  }

  public async replaceForSnapshotSerialized(
    snapshotId: string,
    serialized: string,
  ): Promise<void> {
    await this.deleteForSnapshot(snapshotId);

    const chunks = chunkString(serialized, OVERFLOW_CHUNK_SIZE_CHARS);
    await promiseAllChunks(
      chunks.map((data, chunkIndex) => async () => {
        await this.create({ snapshot: snapshotId, chunkIndex, data });
      }),
      3,
    );
  }

  public async getAnalysesForSnapshot(
    snapshotId: string,
  ): Promise<ExperimentSnapshotAnalysis[]> {
    const docs = await this._find(
      { snapshot: snapshotId },
      { sort: { chunkIndex: 1 } },
    );
    if (!docs.length) return [];
    return parseAnalyses(docs.map((d) => d.data).join(""));
  }

  public async getAnalysesForSnapshots(
    snapshotIds: string[],
  ): Promise<Map<string, ExperimentSnapshotAnalysis[]>> {
    const result = new Map<string, ExperimentSnapshotAnalysis[]>();
    if (!snapshotIds.length) return result;

    const docs = await this._find(
      { snapshot: { $in: snapshotIds } },
      { sort: { snapshot: 1, chunkIndex: 1 } },
    );

    const bySnapshot = new Map<string, string[]>();
    for (const doc of docs) {
      const arr = bySnapshot.get(doc.snapshot) ?? [];
      arr.push(doc.data);
      bySnapshot.set(doc.snapshot, arr);
    }
    for (const [snapshotId, chunks] of bySnapshot) {
      result.set(snapshotId, parseAnalyses(chunks.join("")));
    }
    return result;
  }

  public async deleteForSnapshot(snapshotId: string): Promise<void> {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      snapshot: snapshotId,
    });
  }

  public async deleteForSnapshots(snapshotIds: string[]): Promise<void> {
    if (!snapshotIds.length) return;
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      snapshot: { $in: snapshotIds },
    });
  }
}
