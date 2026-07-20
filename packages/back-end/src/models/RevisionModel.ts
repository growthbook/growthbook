import uniqid from "uniqid";
import {
  revisionValidator,
  activityLogEntryValidator,
  Revision,
  ActivityLogEntry,
  RevisionTargetType,
  ReviewDecision,
  JsonPatchOperation,
  ScheduledPublishInput,
  getApprovalFlowSettings,
  isRevisionEditLockedBySchedule,
} from "shared/enterprise";
import { ACTIVE_DRAFT_STATUSES, ActiveDraftStatus } from "shared/validators";
import type { CreateProps, UpdateProps } from "shared/types/base-model";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import {
  ArmAcknowledgments,
  hasArmAcknowledgments,
} from "back-end/src/services/armGuards";
import { getAdapter } from "back-end/src/revisions/index";
import { ConflictError } from "back-end/src/util/errors";
import {
  createWithVersionRetry,
  getCollection,
} from "back-end/src/util/mongo.util";

// Derived from the validator so the two can't drift apart.
const VALID_ACTIVITY_LOG_ACTIONS: ReadonlySet<ActivityLogEntry["action"]> =
  new Set(activityLogEntryValidator.shape.action.options);

export const COLLECTION_NAME = "revisions";

// Name of the partial-unique index that enforces "at most one armed lock-others
// schedule per entity" (see additionalIndexes below). Used to recognize the
// duplicate-key error it raises.
const LOCK_OTHERS_INDEX_NAME = "uniqueArmedPublishLockOthers";

const PUBLISH_LOCK_CONFLICT_MESSAGE =
  "Another draft of this entity already has a scheduled publish that locks other drafts. Cancel it before scheduling another.";

// Poller-failure bookkeeping — cleared on cancel and on every (re)arm so a fresh
// schedule never inherits a prior schedule's "stuck" state or attempt count.
const SCHEDULED_PUBLISH_FAILURE_UNSET = {
  scheduledPublishAttempts: 1,
  scheduledPublishLastError: 1,
  scheduledPublishNextAttemptAt: 1,
  scheduledPublishGaveUpAt: 1,
} as const;

// Schedule fields cleared together on cancel.
const SCHEDULED_PUBLISH_UNSET = {
  scheduledPublishAt: 1,
  scheduledPublishLockEdits: 1,
  scheduledPublishLockOthers: 1,
  scheduledPublishBypassApproval: 1,
  // The arm-time guard acknowledgments are a per-arm snapshot — a re-arm/cancel
  // must not leave a stale fingerprint that a later publish would compare against.
  armAcknowledgments: 1,
  ...SCHEDULED_PUBLISH_FAILURE_UNSET,
} as const;

// True for the duplicate-key error from the lock-others partial unique index —
// i.e. a concurrent arming request won the race for this entity's lock.
function isPublishLockIndexConflict(e: unknown): boolean {
  return (
    !!e &&
    typeof e === "object" &&
    (e as { code?: number }).code === 11000 &&
    String((e as { message?: string }).message ?? "").includes(
      LOCK_OTHERS_INDEX_NAME,
    )
  );
}

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
  // Operational / scheduling fields are timeline-tracked via the activity log
  // (and explicit revision webhooks), not the audit log. Don't emit a
  // `revision.update` audit entry when one of these is the only thing that
  // changed — e.g. the poller arming/disarming a schedule or recording an
  // attempt. Mirrors FeatureRevisionModel keeping these out of its log/event path.
  skipAuditLogFields: [
    "autoPublishOnApproval",
    "autoPublishEnabledBy",
    "scheduledPublishAt",
    "scheduledPublishLockEdits",
    "scheduledPublishLockOthers",
    "scheduledPublishBypassApproval",
    "scheduledPublishAttempts",
    "scheduledPublishLastError",
    "scheduledPublishNextAttemptAt",
    "scheduledPublishGaveUpAt",
    "armAcknowledgments",
  ],
  // Poller bookkeeping must not bump the user-facing "last update" time.
  skipDateUpdatedFields: [
    "scheduledPublishAttempts",
    "scheduledPublishLastError",
    "scheduledPublishNextAttemptAt",
    "scheduledPublishGaveUpAt",
    "armAcknowledgments",
  ],
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
    // Sparse: only scheduled revisions carry scheduledPublishAt, so the
    // cross-org due-poller scans a tiny set. Mirrors FeatureRevisionModel.
    {
      fields: { scheduledPublishAt: 1 },
      sparse: true,
    },
    // Partial-unique: at most one armed "lock other drafts" schedule per entity,
    // so two concurrent lock-others schedules can't deadlock at fire time. The
    // pre-check in setScheduledPublish is the fast path; this index is the atomic
    // backstop.
    {
      fields: {
        organization: 1,
        "target.type": 1,
        "target.id": 1,
      },
      name: "uniqueArmedPublishLockOthers",
      unique: true,
      partialFilterExpression: {
        autoPublishOnApproval: true,
        scheduledPublishLockOthers: true,
      },
    },
  ],
});

export class RevisionModel extends BaseClass {
  /**
   * Retry a create operation on duplicate-key error. The unique
   * (organization, target.type, target.id, version) index can collide when two
   * concurrent creates compute the same version number in `beforeCreate`. On a
   * collision we re-run the operation; `beforeCreate` will recompute version
   * against the now-larger set of existing revisions.
   *
   * IMPORTANT: All revision-creating call sites (including
   * `dangerousCreateBypassPermission`) must go through this wrapper. Delegates
   * to the shared `createWithVersionRetry` util so the retry semantics stay
   * in lockstep with `FeatureRevisionModel.createRevision`.
   */
  public createWithVersionRetry<R>(op: () => Promise<R>): Promise<R> {
    return createWithVersionRetry(op);
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
   * Pure helper: contributors[] with `userId` appended (deduplicated). Used only
   * to compose the returned doc — the persisted write goes through the atomic
   * `addContributor` so concurrent edits can't drop a contributor.
   */
  private withContributor(
    existing: Revision["contributors"],
    userId: string,
  ): string[] {
    const list = existing ?? [];
    return list.includes(userId) ? list : [...list, userId];
  }

  // Atomic $addToSet — a read-modify-write $set of the whole array could drop a
  // concurrent editor and defeat blockSelfApproval.
  private async addContributor(id: string, userId: string): Promise<void> {
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id },
      { $addToSet: { contributors: userId } },
    );
  }

  // The revision pipeline only models top-level add/replace ops end-to-end;
  // remove/move/copy/test are dropped at merge time (buildMergeDesiredState) and
  // invisible to conflict detection, so accepting them at save would silently
  // discard the change at publish. Reject at the save boundary; already-stored
  // docs are unaffected (read paths stay permissive).
  private assertSupportedPatchOps(ops: JsonPatchOperation[]): void {
    for (const op of ops) {
      if (op.op !== "replace" && op.op !== "add") {
        throw new Error(
          `Unsupported patch operation "${op.op}" — only top-level "replace" and "add" operations are supported`,
        );
      }
    }
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
    if (!this.context.hasPremiumFeature("require-approvals")) return {};

    // The adapter may override how reset-on-change is determined (constants key
    // off the feature `requireReviews` model). Default to the entity's
    // approval-flow toggle.
    const adapter = getAdapter(existing.target.type);
    const shouldReset = adapter.shouldResetReviewOnChange
      ? adapter.shouldResetReviewOnChange(this.context, existing)
      : !!getApprovalFlowSettings(
          this.context.org.settings?.approvalFlows,
          existing.target.type,
        )?.resetReviewOnChange;
    if (!shouldReset) return {};
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

  // Demote the current cycle's active verdicts to stale (mirrors the feature
  // flow's "-stale" variants). Called at every cycle reset so verdict activeness
  // is persisted on the record rather than recomputed from the activity log.
  // Comments and already-stale entries are left untouched.
  private staleVerdicts(reviews: Revision["reviews"]): Revision["reviews"] {
    return reviews.map((r) =>
      r.decision !== "comment" && !r.stale ? { ...r, stale: true } : r,
    );
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
  protected canUpdate(
    existing: Revision,
    _updates: UpdateProps<Revision>,
    _newDoc: Revision,
  ): boolean {
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

  protected migrate(legacyDoc: unknown): Revision {
    let doc = legacyDoc as Revision;
    // Clear the legacy synthetic `Revision N` title so it's treated as
    // uncustomized (the UI falls back to "Revision N" on its own).
    if (doc.title && doc.title === `Revision ${doc.version}`) {
      doc = { ...doc, title: undefined };
    }
    // Backfill verdict staleness for revisions written before the `stale` flag.
    // Only genuine multi-cycle legacy docs need it: a verdict predating the
    // latest cycle-start entry (review-requested / reopened) belongs to an
    // earlier cycle. New docs already carry the flag on demoted verdicts, and a
    // single-cycle doc has no prior cycle — both are skipped, so this never runs
    // on the normal read path.
    const reviews = doc.reviews ?? [];
    const cycleStarts = (doc.activityLog ?? [])
      .filter((e) => e.action === "review-requested" || e.action === "reopened")
      .map((e) => e.dateCreated);
    const isLegacyMultiCycle =
      cycleStarts.length > 1 &&
      reviews.some((r) => r.decision !== "comment") &&
      reviews.every((r) => r.stale === undefined);
    if (isLegacyMultiCycle) {
      const cs = cycleStarts.reduce((a, b) => (b > a ? b : a));
      doc = {
        ...doc,
        reviews: reviews.map((r) =>
          r.decision !== "comment" && r.dateCreated < cs
            ? { ...r, stale: true }
            : r,
        ),
      };
    }
    return doc;
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

    // No default title — an uncustomized revision has none, and the UI falls back
    // to "Revision N" (matching the feature flow).

    if (!doc.activityLog || doc.activityLog.length === 0) {
      const activityLog: ActivityLogEntry[] = [
        {
          id: uniqid("act_"),
          userId: doc.authorId,
          action: "created",
          dateCreated: doc.dateCreated,
          // Capture the proposed changes that existed at the moment this
          // revision was created so the UI can show a per-entry diff for
          // the "created" row. For most revisions this is an empty array,
          // but for revert-style revisions it contains the initial revert
          // ops and the diff is meaningful.
          proposedChangesSnapshot: doc.target.proposedChanges,
          // Persist the original baseline separately so per-entry diffs
          // stay correct even if the revision is later rebased (which
          // mutates `target.snapshot` in place).
          targetSnapshot: doc.target.snapshot,
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
    updates: UpdateProps<Revision>,
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

  /**
   * Same permission/count caveat as `getAllPaginated`.
   *
   * `entityId` / `authorId` are optional filters layered on top of the
   * type-scoped query — used by the cross-entity REST listing endpoints
   * (e.g. `GET /v1/saved-groups/revisions?savedGroupId=...&author=...`).
   */
  async getByTargetTypePaginated(
    entityType: RevisionTargetType,
    opts: {
      status?: string | string[];
      entityId?: string;
      authorId?: string;
      limit?: number;
      skip?: number;
    } = {},
  ): Promise<{ revisions: Revision[]; total: number }> {
    const { limit, skip } = opts;
    const statusFilter = this.buildStatusFilter(opts.status);
    const filter = {
      "target.type": entityType,
      ...(opts.entityId ? { "target.id": opts.entityId } : {}),
      ...(opts.authorId ? { authorId: opts.authorId } : {}),
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

  async hasAnyByTarget(
    entityType: RevisionTargetType,
    entityId: string,
  ): Promise<boolean> {
    const count = await this._countDocuments({
      "target.type": entityType,
      "target.id": entityId,
    } as Record<string, unknown>);
    return count > 0;
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

  /** Look up a single revision by entity type, entity id, and 1-based version. */
  async getByTargetAndVersion(
    entityType: RevisionTargetType,
    entityId: string,
    version: number,
  ) {
    return this._findOne({
      "target.type": entityType,
      "target.id": entityId,
      version,
    } as Record<string, unknown>);
  }

  /**
   * Most-recently-updated open revision for the entity (any author). When
   * `authorId` is supplied, restrict to revisions authored by that user — the
   * `?mine=true` query path. Used by the public `revisions/latest` endpoint.
   */
  async getLatestOpenByTarget(
    entityType: RevisionTargetType,
    entityId: string,
    options: { authorId?: string } = {},
  ) {
    const filter: Record<string, unknown> = {
      "target.type": entityType,
      "target.id": entityId,
      status: { $nin: ["merged", "discarded"] },
    };
    if (options.authorId) {
      filter.authorId = options.authorId;
    }
    const results = await this._find(filter, {
      sort: { dateUpdated: -1, id: -1 },
      limit: 1,
    });
    return results[0] ?? null;
  }

  /**
   * The most-recently-published (merged) revision for the entity — the one whose
   * post-merge state is currently live. A merged revision is terminal, so its
   * `dateUpdated` reflects the merge time; sort by it (then version/id) to pick the
   * latest publish even if drafts were published out of creation order. Used to
   * capture the pinned revision when locking a config.
   */
  async getLatestMergedByTarget(
    entityType: RevisionTargetType,
    entityId: string,
  ) {
    const results = await this._find(
      {
        "target.type": entityType,
        "target.id": entityId,
        status: "merged",
      } as Record<string, unknown>,
      { sort: { dateUpdated: -1, version: -1, id: -1 }, limit: 1 },
    );
    return results[0] ?? null;
  }

  /**
   * Paginated revisions for a single entity. Mirrors `getByTargetTypePaginated`
   * but adds an entity-id filter and optional author/mine filters used by the
   * per-entity list endpoint.
   */
  async getByTargetPaginated(
    entityType: RevisionTargetType,
    entityId: string,
    opts: {
      status?: string | string[];
      authorId?: string;
      limit?: number;
      skip?: number;
    } = {},
  ): Promise<{ revisions: Revision[]; total: number }> {
    const { limit, skip } = opts;
    const statusFilter = this.buildStatusFilter(opts.status);
    const filter: Record<string, unknown> = {
      "target.type": entityType,
      "target.id": entityId,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(opts.authorId ? { authorId: opts.authorId } : {}),
    };

    const [revisions, total] = await Promise.all([
      this._find(filter, {
        limit,
        skip,
        sort: { dateCreated: -1, id: -1 },
      }),
      this._countDocuments(filter),
    ]);

    return { revisions, total };
  }

  // Review

  async submitForReview(
    id: string,
    userId: string,
    {
      autoPublishOnApproval,
      armAcknowledgments,
    }: {
      autoPublishOnApproval?: boolean;
      armAcknowledgments?: ArmAcknowledgments;
    } = {},
  ) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    // `changes-requested` is also re-submittable: after a reviewer requests
    // changes and the author edits the revision, this is the transition back
    // into `pending-review`. (Saved-group edits don't auto-reset the status the
    // way feature edits do, so this is the only path out of changes-requested.)
    if (
      existing.status !== "draft" &&
      existing.status !== "changes-requested"
    ) {
      throw new Error(
        "Only draft or changes-requested revisions can be submitted for review",
      );
    }

    const updated = await this.update(existing, {
      status: "pending-review",
      // Submitting (or re-submitting from changes-requested) starts a fresh
      // review cycle — demote any prior verdicts.
      reviews: this.staleVerdicts(existing.reviews),
      autoPublishOnApproval: !!autoPublishOnApproval,
      // The auto-publish runs with the arming user's authority. A stale
      // value from a previous cycle is harmless — `autoPublishOnApproval`
      // gates everything. `userId` is empty for API-key actors; skip so the
      // publish falls back to `authorId`.
      ...(autoPublishOnApproval && userId
        ? { autoPublishEnabledBy: userId }
        : {}),
      // Arm-time guard fingerprints: set the new acknowledgments, or clear a
      // stale set from a prior arm (to {}) so a re-arm with no current conflicts
      // can't be covered by an outdated fingerprint.
      ...(autoPublishOnApproval &&
      (hasArmAcknowledgments(armAcknowledgments) ||
        hasArmAcknowledgments(existing.armAcknowledgments))
        ? { armAcknowledgments: armAcknowledgments ?? {} }
        : {}),
      activityLog: [
        ...this.cleanActivityLog(existing.activityLog),
        {
          id: uniqid("act_"),
          userId,
          // Dedicated action so the timeline renders a "Review Requested" event
          // (mirrors FeatureRevisionModel.markRevisionAsReviewRequested) rather
          // than a confusing "reopened"/"created" row. Recognized as a review
          // cycle-start marker by addReview/undoReview.
          action: "review-requested",
          description: "Submitted for review",
          dateCreated: new Date(),
        },
      ],
    } as UpdateProps<Revision>);

    // Submitting with the flag off must scrub any prior dated schedule + locks
    // (this.update can only flip the flag) — otherwise a later re-arm could
    // resurrect a stale schedule. Mirrors setAutoPublishOnApproval's disarm.
    if (
      !autoPublishOnApproval &&
      (existing.autoPublishOnApproval ||
        (existing.scheduledPublishAt ?? null) !== null)
    ) {
      const refreshed = await this.disarmScheduledPublish(id);
      if (refreshed) return refreshed;
    }

    return updated;
  }

  // Arm/disarm auto-publish-on-approval after a draft has already been
  // submitted for review (the submit-for-review path handles the draft case).
  async setAutoPublishOnApproval(
    id: string,
    userId: string,
    enabled: boolean,
    { armAcknowledgments }: { armAcknowledgments?: ArmAcknowledgments } = {},
  ) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    if (
      !["draft", "pending-review", "changes-requested", "approved"].includes(
        existing.status,
      )
    ) {
      throw new Error(
        "Cannot change auto-publish on a published or discarded revision",
      );
    }

    // Auto-publish runs with the arming user's authority. A stale
    // autoPublishEnabledBy left behind when disabling is harmless —
    // autoPublishOnApproval gates everything.
    const updated = await this.update(existing, {
      autoPublishOnApproval: enabled,
      ...(enabled && userId ? { autoPublishEnabledBy: userId } : {}),
      // Arm-time guard fingerprints: set the new acknowledgments, or clear a
      // stale set from a prior arm (to {}) so a re-arm with no current conflicts
      // can't be covered by an outdated fingerprint.
      ...(enabled &&
      (hasArmAcknowledgments(armAcknowledgments) ||
        hasArmAcknowledgments(existing.armAcknowledgments))
        ? { armAcknowledgments: armAcknowledgments ?? {} }
        : {}),
    } as UpdateProps<Revision>);

    // A fresh arm supersedes a prior schedule's parked failure — clear it so
    // the "Could not publish" notice doesn't persist next to a healthy arm
    // (the dated-schedule arm and disarm paths already do this).
    if (enabled && (existing.scheduledPublishGaveUpAt ?? null) !== null) {
      await this._dangerousGetCollection().updateOne(
        { organization: this.context.org.id, id },
        { $unset: { ...SCHEDULED_PUBLISH_FAILURE_UNSET } },
      );
      const refreshed = await this.getById(id);
      if (refreshed) return refreshed;
    }

    // Disabling: this.update can only flip the flag, leaving scheduledPublishAt
    // and the locks set on the document. Scrub the whole schedule so a later
    // re-arm can't resurrect a stale dated schedule and fire it (or re-block
    // siblings via the lock-others index) without fresh confirmation. Mirrors
    // recallReview / addReview's changes-requested disarm.
    if (
      !enabled &&
      (existing.autoPublishOnApproval ||
        (existing.scheduledPublishAt ?? null) !== null)
    ) {
      const refreshed = await this.disarmScheduledPublish(id);
      if (refreshed) return refreshed;
    }

    return updated;
  }

  async addReview(
    id: string,
    userId: string,
    decision: ReviewDecision,
    comment: string,
  ) {
    const actionMap: Record<
      ReviewDecision,
      "approved" | "requested-changes" | "commented"
    > = {
      approve: "approved",
      "request-changes": "requested-changes",
      comment: "commented",
    };

    // Build these once so CAS retries re-base the same entry, not a duplicate.
    const review: Revision["reviews"][number] = {
      id: uniqid("rev_"),
      userId,
      decision,
      ...(comment ? { comment } : {}),
      dateCreated: new Date(),
    };
    const activityEntry: ActivityLogEntry = {
      id: uniqid("act_"),
      userId,
      action: actionMap[decision],
      ...(comment ? { description: comment } : {}),
      dateCreated: new Date(),
    };

    // CAS-guard the status reconcile so a concurrent verdict can't be lost.
    const updated = await this.updateWithCas(
      id,
      ["reviews", "status", "activityLog"],
      (existing) => {
        // Re-checked under CAS: a verdict must not resurrect a revision that was
        // merged or discarded concurrently with this review.
        if (existing.status === "merged" || existing.status === "discarded") {
          throw new Error(`Cannot review a ${existing.status} revision`);
        }

        // Latest active (non-stale) verdict per reviewer; comments carry none.
        // Prior cycles' verdicts were demoted to stale at the reset (see
        // staleVerdicts), so they're history, not active approvals/blocks.
        const verdictByReviewer = new Map<string, ReviewDecision>();
        for (const r of [...existing.reviews, review]) {
          if (r.decision === "comment" || r.stale) continue;
          verdictByReviewer.set(r.userId, r.decision);
        }
        const verdicts = Array.from(verdictByReviewer.values());

        // Aggregate across reviewers — one reviewer's approval must not
        // override another reviewer's standing request-changes. Comments leave
        // the status unchanged.
        const newStatus =
          decision === "comment"
            ? existing.status
            : verdicts.includes("request-changes")
              ? "changes-requested"
              : verdicts.includes("approve")
                ? "approved"
                : existing.status;

        return {
          reviews: [...existing.reviews, review],
          status: newStatus,
          activityLog: [
            ...this.cleanActivityLog(existing.activityLog),
            activityEntry,
          ],
        } as UpdateProps<Revision>;
      },
    );
    if (!updated) throw new Error("Revision not found");

    // A changes-requested verdict disarms any pending scheduled publish so a
    // stale approval can't fire later (re-arm after re-approval).
    if (
      updated.status === "changes-requested" &&
      updated.autoPublishOnApproval
    ) {
      // Clear the whole schedule (not just the armed flag) so a later
      // "when approved" re-arm can't fire the stale dated schedule.
      const refreshed = await this.disarmScheduledPublish(id);
      if (refreshed) return refreshed;
    }

    return updated;
  }

  // Disarm auto-publish AND clear the dated schedule + locks in one raw write
  // (this.update can't $unset). Used by the disarm paths (changes-requested,
  // recall) so a later "when approved" re-arm can't resurrect a stale dated
  // schedule and fire it without a fresh approval.
  // Returns the refreshed revision so callers don't hand back a doc that still
  // carries the now-cleared scheduledPublishAt / lock fields.
  private async disarmScheduledPublish(id: string): Promise<Revision | null> {
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id },
      {
        $set: { autoPublishOnApproval: false },
        $unset: { ...SCHEDULED_PUBLISH_UNSET, autoPublishEnabledBy: 1 },
      },
    );
    return this.getById(id);
  }

  // Recall / undo / comment-edit (review lifecycle)

  /**
   * Pull a review request back to draft. Clears reviews and disarms
   * auto-publish — recall restarts the lifecycle, so prior verdicts are no
   * longer active. Emits a "reopened" entry, which `addReview` uses as the
   * cycle-start marker (so any straggler verdicts are correctly treated as
   * pre-cycle history).
   */
  async recallReview(id: string, userId: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    if (
      !["pending-review", "changes-requested", "approved"].includes(
        existing.status,
      )
    ) {
      throw new Error("Only a revision in review can be returned to draft");
    }

    const updated = await this.update(existing, {
      status: "draft",
      reviews: [],
      autoPublishOnApproval: false,
      activityLog: [
        ...this.cleanActivityLog(existing.activityLog),
        {
          id: uniqid("act_"),
          userId,
          action: "reopened",
          description: "Recalled review request — returned to draft",
          dateCreated: new Date(),
        },
      ],
    } as UpdateProps<Revision>);

    // this.update can't $unset, so clear any pending dated schedule + locks in a
    // follow-up raw write — otherwise a stale scheduledPublishAt could fire on a
    // later re-arm before a new review cycle completes.
    if (
      existing.autoPublishOnApproval ||
      (existing.scheduledPublishAt ?? null) !== null
    ) {
      const refreshed = await this.disarmScheduledPublish(id);
      if (refreshed) return refreshed;
    }
    return updated;
  }

  /**
   * Retract the calling user's own active verdict in the current review cycle.
   * Unlike recall, this must NOT reset the cycle — other reviewers' verdicts
   * survive — so it logs a "review-retracted" entry (not a cycle-start action)
   * and recomputes status from the remaining active verdicts. CAS-guarded like
   * addReview.
   */
  async undoReview(id: string, userId: string) {
    const updated = await this.updateWithCas(
      id,
      ["reviews", "status", "activityLog"],
      (existing) => {
        if (
          existing.status !== "approved" &&
          existing.status !== "changes-requested"
        ) {
          throw new Error("No active review verdict to retract");
        }

        const isCallerVerdict = (r: Revision["reviews"][number]) =>
          r.userId === userId && r.decision !== "comment" && !r.stale;

        if (!existing.reviews.some(isCallerVerdict)) {
          throw new Error("You have no active review verdict to retract");
        }

        // The verdict(s) being retracted — kept only to record their decision
        // in the activity entry below (the timeline reconstructs a muted
        // "Retracted" verdict card from it, mirroring how features soft-retain
        // the verdict log entry).
        const retracted = existing.reviews.filter(isCallerVerdict);

        // Drop the caller's active verdict(s); keep comments and other
        // reviewers' verdicts.
        const newReviews = existing.reviews.filter((r) => !isCallerVerdict(r));

        // Build inside the closure so a CAS retry re-derives the decision from
        // the (re-read) reviews rather than reusing a stale one. The retracted
        // decision + original timestamp are encoded so the timeline can render
        // the original verdict card with a "Retracted" badge even though the
        // verdict is no longer in reviews[].
        const retractedVerdict = retracted[retracted.length - 1];
        const activityEntry: ActivityLogEntry = {
          id: uniqid("act_"),
          userId,
          action: "review-retracted",
          description: JSON.stringify({
            decision: retractedVerdict?.decision,
            verdictDate: retractedVerdict?.dateCreated.toISOString(),
            ...(retractedVerdict?.comment
              ? { comment: retractedVerdict.comment }
              : {}),
          }),
          dateCreated: new Date(),
        };

        // Recompute status from the remaining active verdicts.
        const verdictByReviewer = new Map<string, ReviewDecision>();
        for (const r of newReviews) {
          if (r.decision === "comment" || r.stale) continue;
          verdictByReviewer.set(r.userId, r.decision);
        }
        const verdicts = Array.from(verdictByReviewer.values());
        const newStatus = verdicts.includes("request-changes")
          ? "changes-requested"
          : verdicts.includes("approve")
            ? "approved"
            : "pending-review";

        return {
          reviews: newReviews,
          status: newStatus,
          activityLog: [
            ...this.cleanActivityLog(existing.activityLog),
            activityEntry,
          ],
        } as UpdateProps<Revision>;
      },
    );
    if (!updated) throw new Error("Revision not found");
    return updated;
  }

  /**
   * Edit the body of a comment the calling user authored. Only "comment"
   * reviews are editable (verdicts are immutable history — change them via
   * undoReview). Does not touch status. CAS-guarded on `reviews`.
   */
  async editComment(
    id: string,
    reviewId: string,
    userId: string,
    comment: string,
  ) {
    const updated = await this.updateWithCas(id, ["reviews"], (existing) => {
      if (existing.status === "merged" || existing.status === "discarded") {
        throw new Error(
          "Cannot edit a comment on a merged or discarded revision",
        );
      }
      const idx = existing.reviews.findIndex((r) => r.id === reviewId);
      if (idx < 0) throw new Error("Comment not found");
      const entry = existing.reviews[idx];
      if (entry.decision !== "comment") {
        throw new Error("Only comments can be edited");
      }
      if (entry.userId !== userId) {
        throw new Error("You can only edit your own comment");
      }
      const newReviews = [...existing.reviews];
      newReviews[idx] = { ...entry, comment };
      return { reviews: newReviews } as UpdateProps<Revision>;
    });
    if (!updated) throw new Error("Revision not found");
    return updated;
  }

  /** Delete a comment the calling user authored. Only "comment" reviews. */
  async deleteComment(id: string, reviewId: string, userId: string) {
    const updated = await this.updateWithCas(id, ["reviews"], (existing) => {
      if (existing.status === "merged" || existing.status === "discarded") {
        throw new Error(
          "Cannot delete a comment on a merged or discarded revision",
        );
      }
      const entry = existing.reviews.find((r) => r.id === reviewId);
      if (!entry) throw new Error("Comment not found");
      if (entry.decision !== "comment") {
        throw new Error("Only comments can be deleted");
      }
      if (entry.userId !== userId) {
        throw new Error("You can only delete your own comment");
      }
      return {
        reviews: existing.reviews.filter((r) => r.id !== reviewId),
      } as UpdateProps<Revision>;
    });
    if (!updated) throw new Error("Revision not found");
    return updated;
  }

  // Proposed changes

  async updateProposedChanges(
    id: string,
    proposedChanges: JsonPatchOperation[],
    userId: string,
  ) {
    this.assertSupportedPatchOps(proposedChanges);

    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    if (existing.status === "merged" || existing.status === "discarded") {
      throw new Error(
        "Cannot update proposed changes on a discarded or merged revision",
      );
    }

    // A draft frozen by a pending scheduled publish can't take content edits.
    // Rebasing is still allowed (it goes through `rebase`, not this method) so a
    // locked scheduled draft can still track live drift.
    if (isRevisionEditLockedBySchedule(existing)) {
      throw new Error(
        "This draft is locked for a scheduled publish. Cancel the schedule before editing.",
      );
    }

    const cleanedSnapshot = getAdapter(existing.target.type).buildSnapshot(
      existing.target.snapshot as Record<string, unknown>,
    );

    const { status, resetEntry } = this.resetApprovalIfNeeded(existing, userId);

    const updated = await this.update(existing, {
      target: {
        ...existing.target,
        snapshot: cleanedSnapshot as typeof existing.target.snapshot,
        proposedChanges,
      },
      // An approval reset starts a new cycle — demote the prior verdicts.
      ...(status
        ? { status, reviews: this.staleVerdicts(existing.reviews) }
        : {}),
      activityLog: [
        ...this.cleanActivityLog(existing.activityLog),
        {
          id: uniqid("act_"),
          userId,
          action: "updated",
          description: "Updated proposed changes",
          dateCreated: new Date(),
          // Persist the cumulative proposed-changes state as of this edit
          // so the UI can diff it against the previous entry's snapshot
          // and show exactly what this particular edit changed.
          proposedChangesSnapshot: proposedChanges,
        },
        ...(resetEntry ? [resetEntry] : []),
      ],
    } as UpdateProps<Revision>);

    await this.addContributor(id, userId);
    return {
      ...updated,
      contributors: this.withContributor(updated.contributors, userId),
    };
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

    const updated = await this.update(existing, {
      target: {
        ...existing.target,
        snapshot: cleanedSnapshot as typeof existing.target.snapshot,
        proposedChanges: newProposedChanges,
      },
      // An approval reset starts a new cycle — demote the prior verdicts.
      ...(status
        ? { status, reviews: this.staleVerdicts(existing.reviews) }
        : {}),
      activityLog: [
        ...this.cleanActivityLog(existing.activityLog),
        {
          id: uniqid("act_"),
          userId,
          action: "updated" as const,
          description: "Rebased revision on current live state",
          dateCreated: new Date(),
          // Rebase shifts both the baseline snapshot and the proposed
          // changes. Persist both so the UI can reconstruct the state on
          // either side of the rebase for a meaningful per-entry diff.
          proposedChangesSnapshot: newProposedChanges,
          targetSnapshot: cleanedSnapshot,
        },
        ...(resetEntry ? [resetEntry] : []),
      ],
    } as UpdateProps<Revision>);

    await this.addContributor(id, userId);
    return {
      ...updated,
      contributors: this.withContributor(updated.contributors, userId),
    };
  }

  // Merge / close / reopen

  // CAS-guard the status transition on `status` so a concurrent discard/publish
  // can't both land — exactly one lifecycle transition wins; the loser re-reads
  // under CAS and throws. (publishRevision claims the merge before applying
  // changes to the live entity, so a losing discard can't orphan a half-applied
  // change.)
  async merge(
    id: string,
    userId: string,
    options?: {
      bypass?: boolean;
      /** Publish comment, recorded in the merge activity-log entry. */
      comment?: string;
      // Plan-time baseline for bulk publishes: the claim fails if the revision
      // was touched at all since planning (content edit, review, competing
      // lifecycle change), not just if its status moved. dateUpdated rides in
      // the guard fields so a same-status edit racing the read→write window
      // trips the CAS retry, which re-runs this compute and re-checks the
      // baseline. Conflicts throw ConflictError so callers can tell a lost
      // race from an infra failure.
      expected?: { status: string; dateUpdated: Date };
    },
  ) {
    // Whether a schedule was armed on the winning CAS read — used after the
    // status transition lands to scrub the schedule fields.
    let hadSchedule = false;
    const guardFields: (keyof Revision)[] = options?.expected
      ? ["status", "dateUpdated"]
      : ["status"];
    const merged = await this.updateWithCas(id, guardFields, (existing) => {
      if (existing.status === "merged" || existing.status === "discarded") {
        throw new ConflictError(
          "Cannot merge a discarded or already-merged revision",
        );
      }
      const expected = options?.expected;
      if (
        expected &&
        (existing.status !== expected.status ||
          existing.dateUpdated.getTime() !== expected.dateUpdated.getTime())
      ) {
        throw new ConflictError(
          "The revision changed after the publish was planned — re-plan and retry",
        );
      }
      hadSchedule =
        !!existing.autoPublishOnApproval ||
        (existing.scheduledPublishAt ?? null) !== null;
      const base = options?.bypass
        ? "Merged revision (bypass)"
        : "Merged revision";
      const description = options?.comment
        ? `${base}: ${options.comment}`
        : base;
      return {
        status: "merged",
        // Publishing disarms any pending schedule and releases the lock-others
        // partial index (which keys on autoPublishOnApproval:true).
        autoPublishOnApproval: false,
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
      } as UpdateProps<Revision>;
    });
    if (!merged) throw new Error("Revision not found");

    // Fully scrub the schedule fields on publish (this.update can't $unset),
    // matching the feature flow's markRevisionAsPublished.
    if (hadSchedule) {
      const refreshed = await this.disarmScheduledPublish(id);
      if (refreshed) return refreshed;
    }
    return merged;
  }

  async close(id: string, userId: string, reason?: string) {
    let hadSchedule = false;
    const closed = await this.updateWithCas(id, ["status"], (existing) => {
      if (existing.status === "merged" || existing.status === "discarded") {
        throw new Error(
          "Cannot discard an already discarded or merged revision",
        );
      }
      hadSchedule =
        !!existing.autoPublishOnApproval ||
        (existing.scheduledPublishAt ?? null) !== null;
      return {
        status: "discarded",
        // Discarding disarms any pending schedule (releases lock-others index).
        autoPublishOnApproval: false,
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
      } as UpdateProps<Revision>;
    });
    if (!closed) throw new Error("Revision not found");

    // Fully scrub the schedule fields on discard (this.update can't $unset),
    // matching the feature flow.
    if (hadSchedule) {
      const refreshed = await this.disarmScheduledPublish(id);
      if (refreshed) return refreshed;
    }
    return closed;
  }

  /**
   * Roll a just-merged revision back to its pre-merge state after applyChanges
   * failed. Unlike `reopen`, restores the prior status (so an approval isn't
   * lost) and re-arms any schedule `merge` scrubbed — otherwise a fire-time
   * failure would permanently kill the schedule (the poller only sees
   * autoPublishOnApproval:true) instead of retrying next tick. The
   * experiment-guard acknowledgment is restored too, so the retry re-evaluates
   * the guard against the keys the armer already accepted rather than treating a
   * transient apply failure as a fresh (unacknowledged) conflict and parking.
   *
   * Status-guarded raw write: only applies while the doc is still "merged" from
   * the failed publish; returns null if something else moved it concurrently.
   */
  async reopenAfterFailedApply(
    id: string,
    userId: string,
    prior: Revision,
  ): Promise<Revision | null> {
    const now = new Date();
    const buildSet = (lockOthers: boolean): Record<string, unknown> => ({
      status: prior.status,
      dateUpdated: now,
      autoPublishOnApproval: !!prior.autoPublishOnApproval,
      ...(prior.autoPublishEnabledBy
        ? { autoPublishEnabledBy: prior.autoPublishEnabledBy }
        : {}),
      ...(hasArmAcknowledgments(prior.armAcknowledgments)
        ? { armAcknowledgments: prior.armAcknowledgments }
        : {}),
      // Restore the retry bookkeeping `merge()` scrubbed. Otherwise a persistent
      // apply-time failure (e.g. a cycle/composition conflict that only surfaces
      // inside applyChanges) resets the attempt counter every tick and never
      // reaches the give-up cap — it would retry forever instead of parking.
      ...(prior.scheduledPublishAttempts
        ? {
            scheduledPublishAttempts: prior.scheduledPublishAttempts,
            ...(prior.scheduledPublishLastError
              ? { scheduledPublishLastError: prior.scheduledPublishLastError }
              : {}),
            ...(prior.scheduledPublishNextAttemptAt
              ? {
                  scheduledPublishNextAttemptAt:
                    prior.scheduledPublishNextAttemptAt,
                }
              : {}),
          }
        : {}),
      ...((prior.scheduledPublishAt ?? null) !== null
        ? {
            scheduledPublishAt: prior.scheduledPublishAt,
            scheduledPublishLockEdits: !!prior.scheduledPublishLockEdits,
            scheduledPublishLockOthers: lockOthers,
            ...(prior.scheduledPublishBypassApproval
              ? { scheduledPublishBypassApproval: true }
              : {}),
          }
        : {}),
    });

    const filter = {
      organization: this.context.org.id,
      id,
      status: "merged" as const,
    };
    const update = (lockOthers: boolean) => ({
      $set: buildSet(lockOthers),
      $unset: { resolution: 1 as const },
      $push: {
        activityLog: {
          id: uniqid("act_"),
          userId,
          action: "reopened" as const,
          description: "Reopened revision — publish failed to apply",
          dateCreated: now,
        },
      },
    });

    let matchedCount: number;
    try {
      ({ matchedCount } = await this._dangerousGetCollection().updateOne(
        filter,
        update(!!prior.scheduledPublishLockOthers),
      ));
    } catch (e) {
      // A sibling armed a lock-others schedule while we held the merge; restore
      // without the lock rather than losing the schedule entirely.
      if (!isPublishLockIndexConflict(e)) throw e;
      ({ matchedCount } = await this._dangerousGetCollection().updateOne(
        filter,
        update(false),
      ));
    }
    if (!matchedCount) return null;
    return this.getById(id);
  }

  async reopen(id: string, userId: string) {
    // Always reopen into `draft`. A discarded revision may have been in any
    // pre-resolution status (draft, pending-review, changes-requested,
    // approved); landing in `pending-review` can force the author through a
    // review cycle for a revision that was never submitted. Reopening to
    // `draft` lets the author explicitly re-submit via `submitForReview`
    // when ready — a safer default than inferring the pre-discard status.
    const reopened = await this.updateWithCas(id, ["status"], (existing) => {
      return {
        status: "draft",
        resolution: undefined,
        // Reopening restarts the lifecycle — demote any pre-discard verdicts.
        reviews: this.staleVerdicts(existing.reviews),
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
      } as UpdateProps<Revision>;
    });
    if (!reopened) throw new Error("Revision not found");
    return reopened;
  }

  // Scheduled / deferred publish

  /**
   * Arm (or cancel) a deferred publish on a revision. Scheduling implies the
   * armed auto-publish flag; canceling disarms it. The publish later runs with
   * `enabledBy`'s authority (falls back to the draft author when null).
   *
   * Uses a raw, status-guarded write so a revision published/discarded between
   * the caller's read and this write can't get schedule fields stamped back on
   * (which would also leave a stale lock-others doc occupying the partial unique
   * index). Permission gating therefore happens in the controller.
   */
  async setScheduledPublish(
    id: string,
    enabledBy: string | null,
    {
      scheduledPublishAt,
      lockEdits,
      lockOthers,
      bypassApproval,
      armAcknowledgments,
    }: ScheduledPublishInput,
  ): Promise<Revision> {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    const coll = this._dangerousGetCollection();
    const filter = { organization: this.context.org.id, id };
    const now = new Date();

    if (scheduledPublishAt === null) {
      // Nothing armed → no-op, so we don't stamp a misleading "canceled" entry
      // on an already-disarmed or terminal revision.
      if (
        !existing.autoPublishOnApproval &&
        (existing.scheduledPublishAt ?? null) === null
      ) {
        return existing;
      }
      await coll.updateOne(filter, {
        $set: { autoPublishOnApproval: false, dateUpdated: now },
        $unset: { ...SCHEDULED_PUBLISH_UNSET, autoPublishEnabledBy: 1 },
        $push: {
          activityLog: {
            id: uniqid("act_"),
            userId: enabledBy ?? existing.authorId,
            action: "scheduled-publish-canceled",
            description: "Cancelled scheduled publish",
            dateCreated: now,
          },
        },
      });
      const updated = await this.getById(id);
      if (!updated) throw new Error("Revision not found");
      return updated;
    }

    if (lockOthers) {
      await this.assertNoConflictingPublishLock(existing.target, id);
    }

    const armEntry: ActivityLogEntry = {
      id: uniqid("act_"),
      userId: enabledBy ?? existing.authorId,
      action: existing.scheduledPublishAt
        ? "scheduled-publish-updated"
        : "scheduled-publish",
      description: "Scheduled publish",
      dateCreated: now,
    };

    try {
      // Guard against a TOCTOU race: only arm a revision that's still active.
      const { matchedCount } = await coll.updateOne(
        { ...filter, status: { $in: [...ACTIVE_DRAFT_STATUSES] } },
        {
          $set: {
            autoPublishOnApproval: true,
            scheduledPublishAt,
            scheduledPublishLockEdits: !!lockEdits,
            scheduledPublishLockOthers: !!lockOthers,
            dateUpdated: now,
            ...(bypassApproval ? { scheduledPublishBypassApproval: true } : {}),
            ...(enabledBy !== null ? { autoPublishEnabledBy: enabledBy } : {}),
            ...(hasArmAcknowledgments(armAcknowledgments)
              ? { armAcknowledgments }
              : {}),
          },
          // Clear prior poller-failure state so a reschedule doesn't keep the
          // "stuck" UI or prematurely escalate logging on the next fire. Also
          // clear a stale guard fingerprint when this (re-)arm has none.
          $unset: {
            ...SCHEDULED_PUBLISH_FAILURE_UNSET,
            ...(bypassApproval ? {} : { scheduledPublishBypassApproval: 1 }),
            ...(enabledBy === null ? { autoPublishEnabledBy: 1 } : {}),
            ...(hasArmAcknowledgments(armAcknowledgments)
              ? {}
              : { armAcknowledgments: 1 }),
          },
          $push: { activityLog: armEntry },
        },
      );
      if (!matchedCount) {
        throw new Error(
          "This revision can no longer be scheduled — it was published or discarded.",
        );
      }
    } catch (e) {
      if (isPublishLockIndexConflict(e)) {
        throw new Error(PUBLISH_LOCK_CONFLICT_MESSAGE);
      }
      throw e;
    }

    const updated = await this.getById(id);
    if (!updated) throw new Error("Revision not found");
    return updated;
  }

  // Reject arming a second "lock other drafts" schedule on an entity — two would
  // mutually block each other at fire time. Fast pre-check; the partial unique
  // index is the atomic guard against the race. Raw query (org-scoped) so a
  // sibling the caller can't read still counts.
  private async assertNoConflictingPublishLock(
    target: Revision["target"],
    excludeId: string,
  ): Promise<void> {
    const conflict = await this._dangerousGetCollection().findOne(
      {
        organization: this.context.org.id,
        "target.type": target.type,
        "target.id": target.id,
        id: { $ne: excludeId },
        autoPublishOnApproval: true,
        scheduledPublishLockOthers: true,
        scheduledPublishAt: { $ne: null },
        status: { $in: [...ACTIVE_DRAFT_STATUSES] },
      },
      { projection: { _id: 1 } },
    );
    if (conflict) throw new Error(PUBLISH_LOCK_CONFLICT_MESSAGE);
  }

  /**
   * True if another revision has a committed "lock other drafts" schedule
   * blocking sibling publishes. Only applies once committed and no longer
   * awaiting approval — status "approved" (approval flow) or "draft"
   * (no-approval flow). Used by publishRevision before merging.
   */
  async hasPublishLockingScheduledSibling(
    target: Revision["target"],
    excludeId: string,
  ): Promise<boolean> {
    const doc = await this._dangerousGetCollection().findOne(
      {
        organization: this.context.org.id,
        "target.type": target.type,
        "target.id": target.id,
        id: { $ne: excludeId },
        autoPublishOnApproval: true,
        scheduledPublishLockOthers: true,
        // Committed (no longer awaiting approval): approved / no-approval draft,
        // OR an admin bypass schedule (fires regardless of approval).
        $or: [
          { status: { $in: ["approved", "draft"] } },
          {
            scheduledPublishBypassApproval: true,
            status: { $in: ["pending-review", "changes-requested"] },
          },
        ],
      },
      { projection: { _id: 1 } },
    );
    return !!doc;
  }

  /**
   * Record a failed poller attempt so a stuck schedule is visible instead of
   * silently retrying. Intentionally a raw write — no dateUpdated bump, audit,
   * timeline, or webhook — so per-tick retries don't generate noise. Returns the
   * new attempt count.
   */
  async recordScheduledPublishFailure(
    id: string,
    message: string,
  ): Promise<number> {
    const doc = await this._dangerousGetCollection().findOneAndUpdate(
      { organization: this.context.org.id, id },
      {
        $set: { scheduledPublishLastError: message },
        $inc: { scheduledPublishAttempts: 1 },
      },
      { returnDocument: "after", projection: { scheduledPublishAttempts: 1 } },
    );
    return (
      (doc as { scheduledPublishAttempts?: number } | null)
        ?.scheduledPublishAttempts ?? 0
    );
  }

  /**
   * Delay the next poller retry of a failing scheduled publish (backoff). The
   * due-but-failing revision is skipped until this time so doomed retries space
   * out instead of firing every tick. Raw write, like the failure recorder.
   */
  async setScheduledPublishNextAttempt(
    id: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id },
      { $set: { scheduledPublishNextAttemptAt: nextAttemptAt } },
    );
  }

  /**
   * Give up on a failing scheduled publish: clear the schedule (so the poller
   * stops selecting it), disarm auto-publish, and stamp `scheduledPublishGaveUpAt`
   * so the UI can flag the abandoned schedule. The draft is left open (status
   * unchanged) with `scheduledPublishLastError` preserved for context. Raw write
   * (no audit / dateUpdated bump), like the failure recorder — the
   * `revision.publishFailed` webhook is the user-facing signal.
   */
  async parkScheduledPublish(id: string): Promise<void> {
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id },
      {
        $set: {
          scheduledPublishGaveUpAt: new Date(),
          autoPublishOnApproval: false,
        },
        $unset: {
          scheduledPublishAt: 1,
          scheduledPublishLockEdits: 1,
          scheduledPublishLockOthers: 1,
          scheduledPublishBypassApproval: 1,
          scheduledPublishNextAttemptAt: 1,
          armAcknowledgments: 1,
        },
      },
    );
  }

  /**
   * Cross-org poller query for the Agenda job: every armed revision whose date
   * has arrived and is still in an active review cycle. Org-agnostic by design
   * (context is resolved per-org downstream), so this is a static that hits the
   * collection directly rather than going through the org-scoped instance.
   */
  static async dangerouslyFindRevisionsDueToPublish(now: Date): Promise<
    {
      organization: string;
      id: string;
      target: { type: RevisionTargetType; id: string };
    }[]
  > {
    const docs = await getCollection<Revision>(COLLECTION_NAME)
      .find(
        {
          autoPublishOnApproval: true,
          scheduledPublishAt: { $lte: now },
          status: { $in: [...ACTIVE_DRAFT_STATUSES] },
        },
        {
          projection: {
            organization: 1,
            id: 1,
            "target.type": 1,
            "target.id": 1,
          },
        },
      )
      .toArray();
    return docs
      .filter((d) => d.id && d.target?.id)
      .map((d) => ({
        organization: d.organization,
        id: d.id,
        target: { type: d.target.type, id: d.target.id },
      }));
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
    comment?: string;
    revertedFrom?: string;
  }) {
    this.assertSupportedPatchOps(target.proposedChanges);

    // Normalize the snapshot before validation runs in `_createOne`.
    // BaseModel parses `createValidator` *before* `beforeCreate`, so we can't
    // rely on the in-model `beforeUpdate`-style cleanup to strip legacy
    // fields from the live entity (e.g. removed schema fields still sitting
    // on stored docs). The adapter's `buildSnapshot` is the single source of
    // truth for what a snapshot should look like.
    const cleanedSnapshot = getAdapter(target.type).buildSnapshot(
      target.snapshot,
    );

    return this.createWithVersionRetry(() =>
      this.create({
        target: {
          ...target,
          snapshot: cleanedSnapshot,
        },
        title: target.title,
        comment: target.comment,
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

  /**
   * Returns active draft status counts per entity ID for a given revision
   * target type (e.g. "saved-group", "constant"). Mirrors `getActiveDraftStates`
   * in FeatureRevisionModel but operates on the shared Revision collection.
   */
  async getActiveDraftStates(
    type: RevisionTargetType,
    entityIds?: string[],
  ): Promise<Record<string, Partial<Record<ActiveDraftStatus, number>>>> {
    const filter: Record<string, unknown> = {
      "target.type": type,
      status: { $in: ACTIVE_DRAFT_STATUSES },
    };
    if (entityIds && entityIds.length > 0) {
      filter["target.id"] = { $in: entityIds };
    }
    const docs = await this._dangerousGetCollection()
      .find(
        { organization: this.context.org.id, ...filter },
        { projection: { "target.id": 1, status: 1, _id: 0 } },
      )
      .toArray();

    const result: Record<
      string,
      Partial<Record<ActiveDraftStatus, number>>
    > = {};
    for (const doc of docs) {
      const entityId = doc.target?.id as string;
      const status = doc.status as ActiveDraftStatus;
      if (!entityId) continue;
      if (!result[entityId]) result[entityId] = {};
      result[entityId][status] = (result[entityId][status] ?? 0) + 1;
    }
    return result;
  }

  /**
   * Create a revision that is already in `merged` status in a single write.
   *
   * Bypass-merge flows (e.g. PUT /saved-groups/:id) would otherwise have to
   * create a draft and then `merge` it as two separate, non-transactional DB
   * writes — if the merge failed after the entity was already updated, the draft
   * would be stranded and could never be published ("no changes detected"
   * against the now-updated live entity). Recording the merged revision in one
   * write removes that window. Callers must persist the live entity change
   * *before* calling this so the merged revision is a faithful record of a
   * change that has actually landed.
   */
  async createMerged(params: {
    type: RevisionTargetType;
    id: string;
    snapshot: Record<string, unknown>;
    proposedChanges: JsonPatchOperation[];
    bypass?: boolean;
    title?: string;
    revertedFrom?: string;
  }) {
    const cleanedSnapshot = getAdapter(params.type).buildSnapshot(
      params.snapshot,
    );
    const userId = this.context.userId;
    const now = new Date();

    return this.createWithVersionRetry(() =>
      this.create({
        target: {
          type: params.type,
          id: params.id,
          snapshot: cleanedSnapshot,
          proposedChanges: params.proposedChanges,
        },
        title: params.title,
        revertedFrom: params.revertedFrom,
        status: "merged",
        authorId: userId,
        reviews: [],
        resolution: {
          action: "merged",
          userId,
          dateCreated: now,
        },
        activityLog: [
          {
            id: uniqid("act_"),
            userId,
            action: "merged",
            description: params.bypass
              ? "Merged revision (bypass)"
              : "Merged revision",
            dateCreated: now,
          },
        ],
      } as unknown as CreateProps<Revision>),
    );
  }
}
