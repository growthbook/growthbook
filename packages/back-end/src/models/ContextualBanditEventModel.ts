import {
  ContextualBanditEventInterface,
  contextualBanditEventValidator,
  getContextVariationPairCount,
  MAX_CBE_CONTEXT_VARIATION_PAIRS,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: contextualBanditEventValidator,
  collectionName: "contextualbanditevents",
  idPrefix: "cbe_",
  auditLog: {
    entity: "contextualBanditEvent",
    createEvent: "contextualBanditEvent.create",
    // CBE is immutable (canUpdate returns false); the event is required by
    // AuditLogConfig but never fires in practice.
    updateEvent: "contextualBanditEvent.update",
    deleteEvent: "contextualBanditEvent.delete",
  },
  globallyUniquePrimaryKeys: false,
  // Indexes per source plan A2 / Appendix B. Query patterns:
  //   - latest CBE per (experiment, phase) for SDK payload refresh
  //   - lookup by snapshotId (A6 orchestrator side-effect ordering)
  //   - lookup by CBAQ id (CBAQ delete-cascade safety check in A6)
  additionalIndexes: [
    { fields: { organization: 1, experiment: 1, phase: 1, dateCreated: -1 } },
    { fields: { organization: 1, contextualBanditSnapshotId: 1 } },
    { fields: { organization: 1, contextualBanditQueryId: 1 } },
  ],
});

export class ContextualBanditEventModel extends BaseClass {
  // CBE is API-read-only (source plan A6 — `current` / `events` handlers).
  // Internal create comes from the orchestrator only, so canCreate/canUpdate
  // mirror the experiment's read/write scope rather than a CBE-specific
  // permission.
  protected canRead(): boolean {
    // Read scope is enforced upstream by the experiment-scoped handlers
    // (A6 — handlers under `packages/back-end/src/api/experiments/contextual-bandit/`).
    // Returning `true` here keeps the BaseModel's `filterByReadPermissions`
    // a no-op; we rely on the experiment permission gate in the handler.
    return true;
  }

  protected canCreate(): boolean {
    // Orchestrator-only writes; routed via `dangerousCreateBypassPermission`
    // when the orchestrator (A6) needs to persist a result. Block normal
    // create paths so a stray API surface can't mint CBEs directly.
    return false;
  }

  protected canUpdate(): boolean {
    // CBEs are immutable once written — A6 orchestrator rolls forward by
    // emitting a new CBE rather than mutating the previous one.
    return false;
  }

  protected canDelete(): boolean {
    // Allow cascade-delete from the experiment delete handler (A6 will
    // call into this on experiment teardown).
    return true;
  }

  protected async customValidation(
    doc: ContextualBanditEventInterface,
  ): Promise<void> {
    if (!doc.contextResults.length) {
      throw new Error(
        "ContextualBanditEvent must have at least one contextResult",
      );
    }

    // Mongo BSON cap — Σ contextResults × variations ≤ 3000. Enforced
    // here so an upstream stats-engine output regression never silently
    // produces an undeserializable doc.
    const pairs = getContextVariationPairCount(doc);
    if (pairs > MAX_CBE_CONTEXT_VARIATION_PAIRS) {
      throw new Error(
        `ContextualBanditEvent exceeds context×variation cap: ${pairs} > ${MAX_CBE_CONTEXT_VARIATION_PAIRS}`,
      );
    }

    const variationCounts = new Set(
      doc.contextResults.map((r) => r.variations.length),
    );
    if (variationCounts.size > 1) {
      throw new Error(
        "ContextualBanditEvent contextResults have inconsistent variation counts",
      );
    }

    // contextIds must be unique within a single CBE. The orchestrator (A6)
    // detects cross-context collisions by widening the hash slice from 8
    // to 12 chars before write, but a duplicate at this layer would mean
    // the orchestrator skipped that step. Fail closed.
    const seen = new Set<string>();
    for (const result of doc.contextResults) {
      if (seen.has(result.contextId)) {
        throw new Error(
          `Duplicate contextId in ContextualBanditEvent: ${result.contextId}`,
        );
      }
      seen.add(result.contextId);
    }
  }

  public async getLatestForExperimentPhase(
    experimentId: string,
    phase: number,
  ): Promise<ContextualBanditEventInterface | null> {
    const docs = await this._find(
      { experiment: experimentId, phase },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return docs[0] ?? null;
  }

  public async getBySnapshotId(
    contextualBanditSnapshotId: string,
  ): Promise<ContextualBanditEventInterface | null> {
    const docs = await this._find({ contextualBanditSnapshotId }, { limit: 1 });
    return docs[0] ?? null;
  }

  public async listForExperiment(
    experimentId: string,
    { limit = 100 }: { limit?: number } = {},
  ): Promise<ContextualBanditEventInterface[]> {
    return this._find(
      { experiment: experimentId },
      { sort: { dateCreated: -1 }, limit },
    );
  }
}
