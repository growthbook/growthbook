import uniqid from "uniqid";
import {
  revisionValidator,
  activityLogEntryValidator,
  Revision,
  ActivityLogEntry,
  RevisionTargetType,
  ReviewDecision,
  JsonPatchOperation,
  getApprovalFlowSettings,
} from "shared/enterprise";
import type { CreateProps } from "shared/types/base-model";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { getAdapter } from "back-end/src/revisions/index";

// Derived from the validator so the two can't drift apart.
const VALID_ACTIVITY_LOG_ACTIONS: ReadonlySet<ActivityLogEntry["action"]> =
  new Set(activityLogEntryValidator.shape.action.options);

export const COLLECTION_NAME = "revisions";

const BaseClass = MakeModelClass({
  schema: revisionValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "rev_",
  auditLog: {
    entity: "revision",
    createEvent: "revision.create",
    updateEvent: "revision.update",
    deleteEvent: "revision.delete",
  },
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        "target.type": 1,
        "target.id": 1,
        status: 1,
      },
    },
    {
      fields: { organization: 1, authorId: 1 },
    },
    {
      fields: { organization: 1, status: 1 },
    },
    // Index for efficient querying of open revisions by author and target
    {
      fields: {
        organization: 1,
        "target.type": 1,
        "target.id": 1,
        authorId: 1,
        status: 1,
      },
    },
    // Unique index on the per-target version number. Prevents two concurrent
    // creates from being assigned the same version (the version is computed in
    // beforeCreate from a count of existing revisions; without this guard, a
    // race could produce duplicates). Combined with the retry-on-duplicate-key
    // logic in `create()`, this gives correct sequential versioning under
    // concurrency.
    {
      fields: {
        organization: 1,
        "target.type": 1,
        "target.id": 1,
        version: 1,
      },
      unique: true,
    },
  ],
});

const DUPLICATE_KEY_ERROR_CODE = 11000;
const MAX_VERSION_RETRY_ATTEMPTS = 5;

/**
 * Detect MongoDB duplicate-key errors across the various shapes the driver and
 * mongoose can produce: top-level `code`, `writeErrors[].code`, and
 * `BulkWriteError`/`MongoServerError` instances. We deliberately match by code
 * (11000) rather than by error class name so we catch wrapped variants too.
 */
function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as {
    code?: unknown;
    writeErrors?: { code?: unknown }[];
    name?: unknown;
    message?: unknown;
  };
  if (e.code === DUPLICATE_KEY_ERROR_CODE) return true;
  if (
    Array.isArray(e.writeErrors) &&
    e.writeErrors.some((we) => we?.code === DUPLICATE_KEY_ERROR_CODE)
  ) {
    return true;
  }
  // Last-resort match — the driver always includes "E11000" in the message
  // for duplicate-key errors, regardless of which wrapper class is thrown.
  if (typeof e.message === "string" && e.message.includes("E11000")) {
    return true;
  }
  return false;
}

export class RevisionModel extends BaseClass {
  /**
   * Retry a create operation on duplicate-key error. The unique
   * (organization, target.type, target.id, version) index can collide when two
   * concurrent creates compute the same version number in `beforeCreate`. On a
   * collision we re-run the operation; `beforeCreate` will recompute version
   * against the now-larger set of existing revisions.
   *
   * IMPORTANT: All revision-creating call sites (including
   * `dangerousCreateBypassPermission`) must go through this wrapper. The
   * provided `op` is invoked at most MAX_VERSION_RETRY_ATTEMPTS times.
   */
  public async createWithVersionRetry<R>(op: () => Promise<R>): Promise<R> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_VERSION_RETRY_ATTEMPTS; attempt++) {
      try {
        return await op();
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
        lastErr = err;
      }
    }
    throw lastErr;
  }

  /**
   * Filter out invalid activityLog entries (defensive — guards against any old
   * data with action values that are no longer in the schema).
   */
  private cleanActivityLog(
    activityLog: Revision["activityLog"],
  ): Revision["activityLog"] {
    return activityLog.filter((entry) =>
      VALID_ACTIVITY_LOG_ACTIONS.has(entry.action),
    );
  }

  /**
   * Return the existing contributors[] with `userId` appended (deduplicated).
   * Used to track every user who edited a revision's content. The author is
   * always included (seeded in `beforeCreate`).
   *
   * NOTE: This is read-modify-write; safe today because only one user can edit
   * a draft at a time (see PUT /revision/:id/proposed-changes which enforces
   * authorId === userId). If multiple users ever become able to edit a
   * single draft concurrently, switch to an atomic `$addToSet` against the
   * underlying collection.
   */
  private withContributor(
    existing: Revision["contributors"],
    userId: string,
  ): string[] {
    const list = existing ?? [];
    return list.includes(userId) ? list : [...list, userId];
  }

  /**
   * If the entity-type's approval-flow has `resetReviewOnChange` enabled and
   * the revision is currently `approved`, return a status update that bumps
   * it back to `pending-review` plus an activity-log entry describing the
   * reset. Otherwise return an empty object.
   */
  private resetApprovalIfNeeded(
    existing: Revision,
    userId: string,
  ): { status?: Revision["status"]; resetEntry?: ActivityLogEntry } {
    if (existing.status !== "approved") return {};
    const settings = getApprovalFlowSettings(
      this.context.org.settings?.approvalFlows,
      existing.target.type,
    );
    if (!settings?.resetReviewOnChange) return {};
    return {
      status: "pending-review",
      resetEntry: {
        id: uniqid("act_"),
        userId,
        action: "reopened",
        description:
          "Approval reset — proposed changes were modified after approval",
        dateCreated: new Date(),
      },
    };
  }

  /**
   * Delegate read permission to the underlying target entity's read check via adapter.
   */
  protected canRead(doc: Revision): boolean {
    return getAdapter(doc.target.type).canRead(
      this.context,
      doc.target.snapshot as Record<string, unknown>,
    );
  }

  /**
   * Delegate create permission to the underlying target entity's adapter.
   * Without this, any authenticated user could insert a revision document
   * targeting any entity in their org. The adapter's `canCreate` mirrors the
   * permission that gates editing the target itself.
   *
   * NOTE: `dangerousCreateBypassPermission` (inherited from BaseModel) skips
   * this check AND skips the `createWithVersionRetry` wrapper above. Avoid it
   * for revisions; prefer `createRequest` or `createWithVersionRetry(...)`.
   */
  protected canCreate(doc: Revision): boolean {
    return getAdapter(doc.target.type).canCreate(
      this.context,
      doc.target.snapshot as Record<string, unknown>,
    );
  }

  /**
   * Delegate update permission to the underlying target entity via adapter.
   * The author can always update their own revision; otherwise the user must be
   * able to edit the target entity (e.g. for reviews). Merged revisions cannot
   * be updated.
   */
  protected canUpdate(existing: Revision, _updates: Revision): boolean {
    if (existing.status === "merged") return false;

    if (existing.authorId === this.context.userId) return true;

    return getAdapter(existing.target.type).canUpdate(
      this.context,
      existing.target.snapshot as Record<string, unknown>,
    );
  }

  /**
   * Author can delete their own revision. Otherwise, delegate to the adapter.
   */
  protected canDelete(doc: Revision): boolean {
    if (doc.authorId === this.context.userId) return true;

    return getAdapter(doc.target.type).canDelete(
      this.context,
      doc.target.snapshot as Record<string, unknown>,
    );
  }

  protected async beforeCreate(doc: Revision) {
    // Calculate and set the version number
    const allRevisions = await this._find({
      "target.type": doc.target.type,
      "target.id": doc.target.id,
    } as Record<string, unknown>);

    // Sort by creation date to determine the next version
    const sortedRevisions = allRevisions.sort(
      (a, b) =>
        new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
    );

    // Set version to the next sequential number
    doc.version = sortedRevisions.length + 1;

    // Set default title if not provided
    if (!doc.title) {
      doc.title = `Revision ${doc.version}`;
    }

    if (!doc.activityLog || doc.activityLog.length === 0) {
      const activityLog: ActivityLogEntry[] = [
        {
          id: uniqid("act_"),
          userId: doc.authorId,
          action: "created",
          dateCreated: doc.dateCreated,
        },
      ];

      // If this is a revert, add a note in the activity log with revision number
      if (doc.revertedFrom) {
        const revertedFromIdx = sortedRevisions.findIndex(
          (r) => r.id === doc.revertedFrom,
        );
        const description =
          revertedFromIdx >= 0
            ? `This revision reverts changes from Revision ${
                revertedFromIdx + 1
              }`
            : "This revision reverts changes from a prior revision";

        activityLog.push({
          id: uniqid("act_"),
          userId: doc.authorId,
          action: "created",
          description,
          dateCreated: doc.dateCreated,
        });
      }

      doc.activityLog = activityLog;
    }

    // Seed contributors with the author so they're always counted as a
    // contributor (matters for the `blockSelfApproval` setting).
    if (!doc.contributors || doc.contributors.length === 0) {
      doc.contributors = [doc.authorId];
    }
  }

  protected async beforeUpdate(
    existing: Revision,
    updates: Partial<Revision>,
    newDoc: Revision,
  ) {
    // Clean null values from snapshot before validation via the adapter
    newDoc.target.snapshot = getAdapter(newDoc.target.type).buildSnapshot(
      newDoc.target.snapshot as Record<string, unknown>,
    ) as typeof newDoc.target.snapshot;
  }

  // Query helpers

  // Open statuses (anything not yet resolved). Used by inbox/badge queries.
  static readonly OPEN_STATUSES = [
    "draft",
    "pending-review",
    "approved",
    "changes-requested",
  ] as const;

  /**
   * Build a Mongo `status` filter clause from a list/string. Accepts the
   * literal "open" alias for non-merged/non-discarded statuses.
   */
  private buildStatusFilter(
    status?: string | string[],
  ): Record<string, unknown> | undefined {
    if (!status) return undefined;
    const list = Array.isArray(status) ? status : [status];
    if (list.length === 1 && list[0] === "open") {
      return { $nin: ["merged", "discarded"] };
    }
    return { $in: list };
  }

  /**
   * Paginated revision listing.
   *
   * IMPORTANT: BaseModel applies `limit` and `skip` AFTER read-permission
   * filtering, while `_countDocuments` operates on the raw query. As a
   * result, for users with restricted read access:
   *  - A page may contain FEWER than `limit` items (some were filtered out).
   *  - `total` may overstate the visible count.
   * For an org admin the two stay consistent. Acceptable trade-off here
   * since this endpoint is only used by the org-level inbox; revise if
   * stricter consistency is required.
   */
  async getAllPaginated(
    opts: {
      status?: string | string[];
      limit?: number;
      skip?: number;
    } = {},
  ): Promise<{ revisions: Revision[]; total: number }> {
    const { limit, skip } = opts;
    const statusFilter = this.buildStatusFilter(opts.status);
    const filter = (statusFilter ? { status: statusFilter } : {}) as Record<
      string,
      unknown
    >;

    const [revisions, total] = await Promise.all([
      this._find(filter, {
        limit,
        skip,
        // `id` as a tiebreaker keeps pagination stable when multiple revisions
        // share a millisecond-level dateCreated.
        sort: { dateCreated: -1, id: -1 },
      }),
      this._countDocuments(filter),
    ]);

    return { revisions, total };
  }

  /** Same permission/count caveat as `getAllPaginated`. */
  async getByTargetTypePaginated(
    entityType: RevisionTargetType,
    opts: {
      status?: string | string[];
      limit?: number;
      skip?: number;
    } = {},
  ): Promise<{ revisions: Revision[]; total: number }> {
    const { limit, skip } = opts;
    const statusFilter = this.buildStatusFilter(opts.status);
    const filter = {
      "target.type": entityType,
      ...(statusFilter ? { status: statusFilter } : {}),
    } as Record<string, unknown>;

    const [revisions, total] = await Promise.all([
      this._find(filter, {
        limit,
        skip,
        // `id` as a tiebreaker keeps pagination stable when multiple revisions
        // share a millisecond-level dateCreated.
        sort: { dateCreated: -1, id: -1 },
      }),
      this._countDocuments(filter),
    ]);

    return { revisions, total };
  }

  /**
   * Lightweight count of open revisions, optionally scoped to an entity type.
   * Used by the top-nav badge so it doesn't have to fetch full revision docs.
   *
   * NOTE: This count uses the raw query and does NOT apply per-document read
   * permission filters, so it can overstate what a low-permission user can
   * actually see. Acceptable trade-off for a badge; do not rely on it for
   * pagination total counts where exactness matters.
   */
  async getOpenRevisionCount(entityType?: RevisionTargetType): Promise<number> {
    const filter = {
      ...(entityType ? { "target.type": entityType } : {}),
      status: { $nin: ["merged", "discarded"] },
    } as Record<string, unknown>;
    return this._countDocuments(filter);
  }

  /**
   * Lightweight count of open revisions across multiple entity types in a
   * single query. Returns 0 if `entityTypes` is empty. Same permission caveat
   * as `getOpenRevisionCount`.
   */
  async getOpenRevisionCountByTypes(
    entityTypes: RevisionTargetType[],
  ): Promise<number> {
    if (entityTypes.length === 0) return 0;
    return this._countDocuments({
      "target.type": { $in: entityTypes },
      status: { $nin: ["merged", "discarded"] },
    } as Record<string, unknown>);
  }

  async getByTarget(entityType: RevisionTargetType, entityId: string) {
    return this._find({
      "target.type": entityType,
      "target.id": entityId,
    } as Record<string, unknown>);
  }

  async getOpenByTargetAndAuthor(
    entityType: RevisionTargetType,
    entityId: string,
    authorId: string,
  ) {
    return this._findOne({
      "target.type": entityType,
      "target.id": entityId,
      authorId,
      status: { $nin: ["merged", "discarded"] },
    } as Record<string, unknown>);
  }

  // Review

  async submitForReview(id: string, userId: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    if (existing.status !== "draft") {
      throw new Error("Only draft revisions can be submitted for review");
    }

    return this.update(existing, {
      status: "pending-review",
      activityLog: [
        ...this.cleanActivityLog(existing.activityLog),
        {
          id: uniqid("act_"),
          userId,
          action: "created",
          description: "Submitted for review",
          dateCreated: new Date(),
        },
      ],
    } as Partial<Revision>);
  }

  async addReview(
    id: string,
    userId: string,
    decision: ReviewDecision,
    comment: string,
  ) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    const review = {
      id: uniqid("rev_"),
      userId,
      decision,
      ...(comment ? { comment } : {}),
      dateCreated: new Date(),
    };

    const actionMap: Record<
      ReviewDecision,
      "approved" | "requested-changes" | "commented"
    > = {
      approve: "approved",
      "request-changes": "requested-changes",
      comment: "commented",
    };

    const newStatus =
      decision === "approve"
        ? "approved"
        : decision === "request-changes"
          ? "changes-requested"
          : existing.status;

    return this.update(existing, {
      reviews: [...existing.reviews, review],
      status: newStatus,
      activityLog: [
        ...this.cleanActivityLog(existing.activityLog),
        {
          id: uniqid("act_"),
          userId,
          action: actionMap[decision],
          ...(comment ? { description: comment } : {}),
          dateCreated: new Date(),
        },
      ],
    } as Partial<Revision>);
  }

  // Proposed changes

  async updateProposedChanges(
    id: string,
    proposedChanges: JsonPatchOperation[],
    userId: string,
  ) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    const cleanedSnapshot = getAdapter(existing.target.type).buildSnapshot(
      existing.target.snapshot as Record<string, unknown>,
    );

    const { status, resetEntry } = this.resetApprovalIfNeeded(existing, userId);

    return this.update(existing, {
      target: {
        ...existing.target,
        snapshot: cleanedSnapshot as typeof existing.target.snapshot,
        proposedChanges,
      },
      contributors: this.withContributor(existing.contributors, userId),
      ...(status ? { status } : {}),
      activityLog: [
        ...this.cleanActivityLog(existing.activityLog),
        {
          id: uniqid("act_"),
          userId,
          action: "updated",
          description: "Updated proposed changes",
          dateCreated: new Date(),
        },
        ...(resetEntry ? [resetEntry] : []),
      ],
    } as Partial<Revision>);
  }

  async rebase(
    id: string,
    newSnapshot: Record<string, unknown>,
    newProposedChanges: JsonPatchOperation[],
    userId: string,
  ) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    const cleanedSnapshot = getAdapter(existing.target.type).buildSnapshot(
      newSnapshot as Record<string, unknown>,
    );

    const { status, resetEntry } = this.resetApprovalIfNeeded(existing, userId);

    return this.update(existing, {
      target: {
        ...existing.target,
        snapshot: cleanedSnapshot as typeof existing.target.snapshot,
        proposedChanges: newProposedChanges,
      },
      contributors: this.withContributor(existing.contributors, userId),
      ...(status ? { status } : {}),
      activityLog: [
        ...this.cleanActivityLog(existing.activityLog),
        {
          id: uniqid("act_"),
          userId,
          action: "updated" as const,
          description: "Rebased revision on current live state",
          dateCreated: new Date(),
        },
        ...(resetEntry ? [resetEntry] : []),
      ],
    } as Partial<Revision>);
  }

  // Merge / close / reopen

  async merge(id: string, userId: string, options?: { bypass?: boolean }) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    if (existing.status === "merged" || existing.status === "discarded") {
      throw new Error("Cannot merge a discarded or already-merged revision");
    }

    const description = options?.bypass
      ? "Merged revision (bypass)"
      : "Merged revision";

    return this.update(existing, {
      status: "merged",
      resolution: {
        action: "merged",
        userId,
        dateCreated: new Date(),
      },
      activityLog: [
        ...this.cleanActivityLog(existing.activityLog),
        {
          id: uniqid("act_"),
          userId,
          action: "merged",
          description,
          dateCreated: new Date(),
        },
      ],
    } as Partial<Revision>);
  }

  async close(id: string, userId: string, reason?: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    if (existing.status === "merged" || existing.status === "discarded") {
      throw new Error("Cannot discard an already discarded or merged revision");
    }

    return this.update(existing, {
      status: "discarded",
      resolution: {
        action: "discarded",
        userId,
        dateCreated: new Date(),
      },
      activityLog: [
        ...this.cleanActivityLog(existing.activityLog),
        {
          id: uniqid("act_"),
          userId,
          action: "discarded",
          description: reason || "Discarded revision",
          dateCreated: new Date(),
        },
      ],
    } as Partial<Revision>);
  }

  async reopen(id: string, userId: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    return this.update(existing, {
      status: "pending-review",
      resolution: undefined,
      activityLog: [
        ...this.cleanActivityLog(existing.activityLog),
        {
          id: uniqid("act_"),
          userId,
          action: "reopened",
          description: "Reopened revision",
          dateCreated: new Date(),
        },
      ],
    } as Partial<Revision>);
  }

  // History

  async getEntityRevisionHistory(
    entityType: RevisionTargetType,
    entityId: string,
  ) {
    return this._find({
      "target.type": entityType,
      "target.id": entityId,
      status: "merged",
    } as Record<string, unknown>);
  }

  // Beacon: lightweight query returning just target IDs with open revisions

  async getOpenRevisionTargetIds(
    entityType: RevisionTargetType,
  ): Promise<string[]> {
    return this._dangerousGetCollection().distinct("target.id", {
      organization: this.context.org.id,
      "target.type": entityType,
      status: { $nin: ["merged", "discarded"] },
    });
  }

  // Create request (from saved-group controller)

  async createRequest(target: {
    type: RevisionTargetType;
    id: string;
    snapshot: Record<string, unknown>;
    proposedChanges: JsonPatchOperation[];
    title?: string;
    revertedFrom?: string;
  }) {
    return this.createWithVersionRetry(() =>
      this.create({
        target,
        title: target.title,
        revertedFrom: target.revertedFrom,
        status: "draft",
        authorId: this.context.userId,
        reviews: [],
        activityLog: [],
        // CreateProps strips fields generated by BaseModel (id, version,
        // dateCreated, dateUpdated). beforeCreate assigns the version, and
        // BaseModel fills in the rest, so the cast bridges the gap.
      } as unknown as CreateProps<Revision>),
    );
  }
}
