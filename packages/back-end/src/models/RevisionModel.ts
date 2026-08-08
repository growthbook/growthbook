import {
  isUserBlockedFromApproving,
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
  REVIEW_CYCLE_STATUSES,
  reviewCycleOf,
  reviewCycleSupersededMessage,
  statusFromStandingVerdicts,
} from "shared/enterprise";
import uniqid from "uniqid";
import { ACTIVE_DRAFT_STATUSES, ActiveDraftStatus } from "shared/validators";
import type { CreateProps, UpdateProps } from "shared/types/base-model";
import {
  assertCasAuthority,
  buildCasGuard,
  type CasAuthority,
} from "back-end/src/models/casLoop";
import { isRevisionAuthor } from "back-end/src/revisions/revisionAuthority";
import {
  MakeModelClass,
  advancedGuardStamp,
} from "back-end/src/models/BaseModel";
import {
  ArmAcknowledgments,
  hasArmAcknowledgments,
} from "back-end/src/services/armGuards";
import { getAdapter } from "back-end/src/revisions/index";
import { ConflictError } from "back-end/src/util/errors";
import {
  canCommentOnRevision,
  canTouchRevision,
} from "back-end/src/revisions/revisionActions";
import {
  createWithVersionRetry,
  getCollection,
  isDuplicateKeyErrorForIndex,
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
  return isDuplicateKeyErrorForIndex(e, LOCK_OTHERS_INDEX_NAME);
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
    // Merge ORDER, read on every landing. The index above serves the equality filter
    // but leaves the sort blocking — each landing sorted every merged revision of the
    // entity in memory. Extending the same prefix with the sort keys makes it a
    // one-row indexed walk.
    {
      fields: {
        organization: 1,
        "target.type": 1,
        "target.id": 1,
        status: 1,
        "resolution.dateCreated": 1,
        version: 1,
      },
    },
    {
      fields: { organization: 1, authorId: 1 },
    },
    // The LISTING sort. Every paginated read sorts `{dateCreated: -1, id: -1}`, and
    // without the sort keys on the filter's prefix each one was a blocking sort over
    // the whole match — including an entity history page with no status filter, which
    // several views mount at a high limit.
    {
      fields: {
        organization: 1,
        "target.type": 1,
        "target.id": 1,
        dateCreated: -1,
        id: -1,
      },
    },
    {
      fields: {
        organization: 1,
        status: 1,
        dateCreated: -1,
        id: -1,
      },
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

// This engine spells its decisions `approve`/`request-changes`; the shared rule
// speaks in the resulting statuses. One place to translate, so the precedence
// itself is not restated.
function standingVerdicts(
  byReviewer: Map<string, ReviewDecision>,
): ("approved" | "changes-requested")[] {
  return Array.from(byReviewer.values()).flatMap((d) =>
    d === "approve"
      ? (["approved"] as const)
      : d === "request-changes"
        ? (["changes-requested"] as const)
        : [],
  );
}

export class RevisionModel extends BaseClass {
  // Retry on duplicate key: the unique (org, target, version) index collides when two
  // concurrent creates compute the same version in `beforeCreate`, which recomputes
  // against the larger set on retry.
  //
  // EVERY revision-creating call site must go through this wrapper. Delegates
  // to the shared `createWithVersionRetry` util so the retry semantics stay
  // in lockstep with `FeatureRevisionModel.createRevision`.
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
   * contributors[] with `userId` appended (deduplicated). Written as part of the
   * content edit itself, under a CAS guarded on `contributors`, so a concurrent
   * editor causes a retry rather than being dropped.
   */
  private withContributor(
    existing: Revision["contributors"],
    userId: string,
  ): string[] {
    const list = existing ?? [];
    return list.includes(userId) ? list : [...list, userId];
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

  // If the entity-type's approval-flow has `resetReviewOnChange` enabled and
  // the revision is currently `approved`, return a status update that bumps
  // it back to `pending-review` plus an activity-log entry describing the
  // reset. Otherwise return an empty object.
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

  /**
   * The next review-cycle number. Every write that STARTS a cycle stamps this, so a
   * verdict can name the cycle it was formed against and a later one can refuse it.
   *
   * Reopening a revision whose publish FAILED deliberately does not bump: that
   * restores the prior state rather than starting a cycle, and its verdicts stand.
   */
  private nextReviewCycle(existing: Revision): number {
    return reviewCycleOf(existing) + 1;
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

  // Without this, any authenticated user could insert a revision targeting any entity
  // in their org.
  //
  // NOTE: `dangerousCreateBypassPermission` (inherited from BaseModel) skips
  // this check AND skips the `createWithVersionRetry` wrapper above. Avoid it
  // for revisions; prefer `createRequest` or `createWithVersionRetry(...)`.
  protected canCreate(doc: Revision): boolean {
    return canTouchRevision(
      doc.target.type,
      this.context,
      doc.target.snapshot as Record<string, unknown>,
    );
  }

  // The author can always update their own revision; otherwise they must hold
  // one of the revision authorities on the target. Merged revisions cannot be
  // updated. The controller gates the specific action — this only stops a write
  // from someone with no standing at all.
  protected canUpdate(
    existing: Revision,
    _updates: UpdateProps<Revision>,
    _newDoc: Revision,
  ): boolean {
    if (existing.status === "merged") return false;

    if (isRevisionAuthor(existing.authorId, this.context.userId)) return true;

    return canTouchRevision(
      existing.target.type,
      this.context,
      existing.target.snapshot as Record<string, unknown>,
    );
  }

  /**
   * Author can delete their own revision. Otherwise, delegate to the adapter.
   */
  protected canDelete(doc: Revision): boolean {
    if (isRevisionAuthor(doc.authorId, this.context.userId)) return true;

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
      .filter(
        (e) =>
          e.action === "review-requested" ||
          e.action === "reopened" ||
          e.action === "recalled",
      )
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
    // Version allocation is bookkeeping over the RAW collection, on purpose:
    // `_find` filters by canRead, so after a project move a destination-only
    // caller couldn't see the source-project revisions, computed a version that
    // already exists, and hit the unique index on every retry. Max, not count —
    // a deleted revision (a CAS-lost toggle cleans its own up) makes any count
    // undershoot versions that are still taken.
    const [latest] = await this._dangerousGetCollection()
      .find(
        {
          organization: this.context.org.id,
          "target.type": doc.target.type,
          "target.id": doc.target.id,
        },
        { projection: { version: 1 }, sort: { version: -1 }, limit: 1 },
      )
      .toArray();
    doc.version = ((latest?.version as number | undefined) ?? 0) + 1;

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
        const revertedFrom = await this._dangerousGetCollection().findOne(
          { organization: this.context.org.id, id: doc.revertedFrom },
          { projection: { version: 1 } },
        );
        const description = revertedFrom
          ? `This revision reverts changes from Revision ${revertedFrom.version}`
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
    // NOTE: this MUTATES a shared reference. When `target` isn't in `updates`,
    // `newDoc.target` IS `existing.target`, so the line below rewrites the
    // pre-image too. Harmless where it stands — the rebuild is a key-order
    // normalization applied to both diff sides, and it never persists because
    // `target` isn't in the `$set` — but nothing downstream may assume the
    // pre-image survives this hook intact. A CAS guard once did, and Mongo's
    // field-order-sensitive embedded equality turned that into a permanently
    // unsatisfiable filter (see `buildCasGuard`, which clones for this reason).
    //
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
   * The `resolution.dateCreated` a merge should stamp: now, but strictly AFTER
   * the newest merge already recorded for this target.
   *
   * That stamp is what orders landings ("latest merged"), and `new Date()` is
   * millisecond-precision — two merges inside one millisecond tied, leaving the
   * version tiebreak to decide, which orders CREATION and can name v3 as latest
   * when v2 merged after it. Advancing past the previous stamp makes the order
   * unambiguous without depending on wall-clock resolution.
   */
  private async nextMergeStamp(
    entityType: RevisionTargetType,
    entityId: string,
  ): Promise<Date> {
    const [latest] = await this._dangerousGetCollection()
      .find(
        {
          organization: this.context.org.id,
          "target.type": entityType,
          "target.id": entityId,
          status: "merged",
        },
        {
          projection: { "resolution.dateCreated": 1 },
          sort: { "resolution.dateCreated": -1 },
          limit: 1,
        },
      )
      .toArray();
    const previous = (
      latest as { resolution?: { dateCreated?: Date } } | undefined
    )?.resolution?.dateCreated;
    return advancedGuardStamp(previous instanceof Date ? previous : undefined);
  }

  /**
   * Which of these targets the caller may READ, judged on the LIVE entity.
   *
   * A revision's snapshot records where the entity was when the draft was
   * opened, so snapshot-basis readability breaks BOTH ways after a move: the
   * source project keeps seeing history for an entity it no longer owns, and the
   * destination sees none for one it does. The live entity is the authority, and
   * `getByIds` is itself read-filtered — a target it returns is readable.
   *
   * Anything it does not return is excluded, which covers both "present but
   * unreadable" and "deleted" (entity deletion does not cascade to revisions).
   * Fail-CLOSED on purpose, and the two are not worth distinguishing: falling
   * back to the snapshot for a miss would restore the very leak this closes,
   * since a moved-and-unreadable entity still carries a readable old snapshot.
   * The cost is that a hard-deleted entity's orphaned drafts drop out of
   * listings — they are unactionable anyway, and reachable by id.
   */
  private async readableTargetIds(
    entries: { type: RevisionTargetType; id: string }[],
  ): Promise<Set<string>> {
    // Keyed by TYPE and id: ids are unique only within a collection, so a
    // readable Constant would otherwise vouch for a Feature sharing its id.
    const readable = new Set<string>();
    const byType = new Map<RevisionTargetType, Set<string>>();
    for (const { type, id } of entries) {
      // Add into a Set rather than rebuilding an array per entry — this runs
      // over every row of the filtered scan.
      const ids = byType.get(type) ?? new Set<string>();
      ids.add(id);
      byType.set(type, ids);
    }
    for (const [type, ids] of byType) {
      const model = getAdapter(type).getModel(this.context);
      if (!model) continue;
      const found = (await model.getReadScopesByIds([...ids])) as {
        id: string;
      }[];
      for (const entity of found) readable.add(`${type}:${entity.id}`);
    }
    return readable;
  }

  // Pagination and `total` over the rows the caller may READ: a raw count leaked how much
  // activity exists in invisible projects AND broke paging (pages under-filled while
  // `total` overstated). One projected pass, then a full fetch of the page. Widen the
  // projection if an adapter ever reads more than project.
  private async findReadablePage(
    filter: Record<string, unknown>,
    {
      limit,
      skip,
      singleTarget,
    }: {
      limit?: number;
      skip?: number;
      // Set when the filter is already scoped to one entity, so readability is a
      // single decision rather than one per row.
      singleTarget?: { type: RevisionTargetType; id: string };
    },
  ): Promise<{ revisions: Revision[]; total: number }> {
    const sort = { dateCreated: -1 as const, id: -1 as const };

    // Readability comes from the LIVE entity, which cannot be expressed as a filter
    // on this collection — so the general path below has to load every matching row's
    // projection before it can slice.
    //
    // Two callers still take that path: the org inbox and a whole-type listing. Both
    // are bounded by the six projected fields, not whole documents, and both keep an
    // exact `total` over readable rows — which is the property the scan exists for.
    // Inverting the join (resolve readable entity ids, then `target.id: {$in: …}`) is
    // semantically identical and would page in the database, but it is NOT the
    // difference between an `$in` and no `$in`: the fetch below already issues one,
    // sized by the page. Inverting only changes which unbounded list you carry, so
    // the exact `total` is what would have to give first. Left as-is deliberately.
    //
    // Anything scoped to ONE entity — every history page, the hot call — needs a
    // single readability lookup instead. With that answered, the database pages.
    if (singleTarget) {
      const readable = await this.readableTargetIds([singleTarget]);
      if (!readable.has(`${singleTarget.type}:${singleTarget.id}`)) {
        return { revisions: [], total: 0 };
      }
      const total = await this._dangerousGetCollection().countDocuments({
        organization: this.context.org.id,
        ...filter,
      });
      // Same reason as below: `_find`'s per-doc check reads the revision SNAPSHOT,
      // which would undo the live-basis decision just made.
      const rows = await this._find(filter, {
        sort,
        limit,
        skip,
        bypassReadPermissionChecks: true,
      });
      return { revisions: rows, total };
    }

    const projected = await this._dangerousGetCollection()
      .find(
        { organization: this.context.org.id, ...filter },
        {
          projection: {
            id: 1,
            dateCreated: 1,
            "target.type": 1,
            "target.id": 1,
            "target.snapshot.project": 1,
            "target.snapshot.projects": 1,
          },
          // `id` as a tiebreaker keeps pagination stable when multiple
          // revisions share a millisecond-level dateCreated.
          sort,
        },
      )
      .toArray();

    // Readability from the LIVE entity, not the snapshot — see
    // readableTargetIds. One batch per entity type for the whole result set.
    const readableTargets = await this.readableTargetIds(
      projected.map((doc) => ({
        type: doc.target?.type as RevisionTargetType,
        id: doc.target?.id as string,
      })),
    );
    const readableIds = projected
      .filter((doc) =>
        readableTargets.has(`${doc.target?.type}:${doc.target?.id}`),
      )
      .map((doc) => doc.id as string);

    const pageIds = readableIds.slice(
      skip ?? 0,
      limit ? (skip ?? 0) + limit : undefined,
    );
    if (!pageIds.length) return { revisions: [], total: readableIds.length };

    // Readability was decided ABOVE on the live basis. `_find` would re-apply the
    // model's own per-doc check, which reads the revision SNAPSHOT — undoing that
    // decision and hiding a moved entity's history from the project that now owns
    // it, while the total still counted it.
    const rows = await this._find(
      { id: { $in: pageIds } },
      { sort, bypassReadPermissionChecks: true },
    );
    return { revisions: rows, total: readableIds.length };
  }

  /**
   * One revision, readable on the LIVE-entity basis the listings use.
   *
   * `canRead` decides on the revision's SNAPSHOT, which records where the entity
   * was when the draft opened — so after a project move, detail reads and listings
   * disagreed in both directions: the source could still open history for an entity
   * it no longer owns, and the destination was denied history for one it does. The
   * snapshot check can only be a floor, and it is bypassed here so the live basis
   * is the only one that decides.
   *
   * Every handler in the revision controller opens its row through here, not just
   * the GETs. Converting only the reads left the destination able to LIST a moved
   * entity's revisions and then 404 on every verb — the same split, one layer down.
   */
  async getByIdReadable(id: string): Promise<Revision | null> {
    const [doc] = await this._find(
      { id },
      { limit: 1, bypassReadPermissionChecks: true },
    );
    if (!doc) return null;
    const readable = await this.readableTargetIds([
      { type: doc.target.type, id: doc.target.id },
    ]);
    return readable.has(`${doc.target.type}:${doc.target.id}`) ? doc : null;
  }

  /** Every revision for one target, on the same live-entity basis. */
  async getByTargetReadable(
    entityType: RevisionTargetType,
    entityId: string,
  ): Promise<Revision[]> {
    const readable = await this.readableTargetIds([
      { type: entityType, id: entityId },
    ]);
    if (!readable.has(`${entityType}:${entityId}`)) return [];
    return this._find(
      { "target.type": entityType, "target.id": entityId } as Record<
        string,
        unknown
      >,
      { sort: { version: -1 }, bypassReadPermissionChecks: true },
    );
  }

  // Paginated revision listing (the org-level inbox).
  async getAllPaginated(
    opts: {
      status?: string | string[];
      limit?: number;
      skip?: number;
    } = {},
  ): Promise<{ revisions: Revision[]; total: number }> {
    const statusFilter = this.buildStatusFilter(opts.status);
    const filter = (statusFilter ? { status: statusFilter } : {}) as Record<
      string,
      unknown
    >;
    return this.findReadablePage(filter, opts);
  }

  // `entityId` / `authorId` are optional filters layered on top of the
  // type-scoped query — used by the cross-entity REST listing endpoints
  // (e.g. `GET /v1/saved-groups/revisions?savedGroupId=...&author=...`).
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
    const statusFilter = this.buildStatusFilter(opts.status);
    const filter = {
      "target.type": entityType,
      ...(opts.entityId ? { "target.id": opts.entityId } : {}),
      ...(opts.authorId ? { authorId: opts.authorId } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    } as Record<string, unknown>;
    return this.findReadablePage(filter, {
      ...opts,
      ...(opts.entityId
        ? { singleTarget: { type: entityType, id: opts.entityId } }
        : {}),
    });
  }

  // Count of open revisions the caller may READ, optionally scoped to an
  // entity type. Used by the top-nav badge; a raw count leaked how much
  // activity exists in projects outside the caller's access. Same projected
  // pass as the paginated listing, without fetching any full docs.
  async getOpenRevisionCount(entityType?: RevisionTargetType): Promise<number> {
    return this.countReadable({
      ...(entityType ? { "target.type": entityType } : {}),
      status: { $nin: ["merged", "discarded"] },
    });
  }

  /**
   * Count of readable open revisions across multiple entity types in a single
   * query. Returns 0 if `entityTypes` is empty.
   */
  async getOpenRevisionCountByTypes(
    entityTypes: RevisionTargetType[],
  ): Promise<number> {
    if (entityTypes.length === 0) return 0;
    return this.countReadable({
      "target.type": { $in: entityTypes },
      status: { $nin: ["merged", "discarded"] },
    });
  }

  private async countReadable(
    filter: Record<string, unknown>,
  ): Promise<number> {
    // No permission short-circuit here. An "can this caller read everything"
    // fast path skipped the live-entity basis below, so the count kept including
    // revisions whose entity has since moved out of reach or been deleted — and
    // it read as TRUE whenever the org resolves no projects, which is fail-open.
    // The scan is projected (a few fields, indexed filter) and bounded by the
    // open-revision count, which is small by nature.
    const projected = await this._dangerousGetCollection()
      .find(
        { organization: this.context.org.id, ...filter },
        {
          projection: {
            "target.type": 1,
            "target.id": 1,
            "target.snapshot.project": 1,
            "target.snapshot.projects": 1,
          },
        },
      )
      .toArray();
    const readableTargets = await this.readableTargetIds(
      projected.map((doc) => ({
        type: doc.target?.type as RevisionTargetType,
        id: doc.target?.id as string,
      })),
    );
    return projected.filter((doc) =>
      readableTargets.has(`${doc.target?.type}:${doc.target?.id}`),
    ).length;
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
    // Live-entity basis, like every other read. On the snapshot basis this
    // returned null for a moved entity and its caller silently FORKED a new draft
    // instead of editing the author's existing one.
    const readable = await this.readableTargetIds([
      { type: entityType, id: entityId },
    ]);
    if (!readable.has(`${entityType}:${entityId}`)) return null;
    const [doc] = await this._find(
      {
        "target.type": entityType,
        "target.id": entityId,
        authorId,
        status: { $nin: ["merged", "discarded"] },
      } as Record<string, unknown>,
      { limit: 1, bypassReadPermissionChecks: true },
    );
    return doc ?? null;
  }

  /** Look up a single revision by entity type, entity id, and 1-based version. */
  async getByTargetAndVersion(
    entityType: RevisionTargetType,
    entityId: string,
    version: number,
  ) {
    // Live-entity basis, joining the listings, detail and history. `_findOne`
    // applies the per-doc check, which decides on the revision's SNAPSHOT — so
    // after a project move a pinned version resolved for the project that no
    // longer owns the entity and 404'd for the one that does.
    const readable = await this.readableTargetIds([
      { type: entityType, id: entityId },
    ]);
    if (!readable.has(`${entityType}:${entityId}`)) return null;
    const [doc] = await this._find(
      {
        "target.type": entityType,
        "target.id": entityId,
        version,
      } as Record<string, unknown>,
      { limit: 1, bypassReadPermissionChecks: true },
    );
    return doc ?? null;
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
    // Live-entity basis, like every other listing: a snapshot-basis check hides a
    // moved entity's open draft from the project that now owns it, and shows it to
    // the one that no longer does.
    const readable = await this.readableTargetIds([
      { type: entityType, id: entityId },
    ]);
    if (!readable.has(`${entityType}:${entityId}`)) return null;
    const results = await this._find(filter, {
      bypassReadPermissionChecks: true,
      sort: { dateUpdated: -1, id: -1 },
      limit: 1,
    });
    return results[0] ?? null;
  }

  // The most-recently-published (merged) revision for the entity — the one whose
  // post-merge state is currently live. A merged revision is terminal, so its
  // `dateUpdated` reflects the merge time; sort by it (then version/id) to pick the
  // latest publish even if drafts were published out of creation order. Used to
  // capture the pinned revision when locking a config.
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
      // By WHEN IT MERGED, not by version: publishing v3 then v2 leaves v2's content
      // live. `dateUpdated` was wrong the other way — any later touch of an old
      // revision made it "latest" again. `resolution.dateCreated` is stamped once, at
      // the merge, by every path that merges; version breaks same-ms ties.
      {
        sort: { "resolution.dateCreated": -1, version: -1, id: -1 },
        limit: 1,
        // NOT read-filtered: a consistency query, not a user-facing read. The per-doc
        // check decides on the SNAPSHOT, so after a move this returned null for a
        // destination-scoped caller — and `assertLandingBaseline` reads null as "no
        // competing merge", making the baseline re-check a no-op exactly when it
        // mattered.
        bypassReadPermissionChecks: true,
      },
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
    const statusFilter = this.buildStatusFilter(opts.status);
    const filter: Record<string, unknown> = {
      "target.type": entityType,
      "target.id": entityId,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(opts.authorId ? { authorId: opts.authorId } : {}),
    };

    // Same live-entity basis as the cross-entity listings — this one was left on
    // the snapshot basis, so a moved entity's own history page disagreed with the
    // org-level list about what the caller may see.
    return this.findReadablePage(filter, {
      ...opts,
      singleTarget: { type: entityType, id: entityId },
    });
  }

  // Review

  async submitForReview(
    id: string,
    userId: string,
    authority: CasAuthority<Revision>,
    {
      autoPublishOnApproval,
      armAcknowledgments,
      scheduledPublishAt,
      lockEdits,
      lockOthers,
    }: {
      autoPublishOnApproval?: boolean;
      armAcknowledgments?: ArmAcknowledgments;
      /**
       * Arm a DATED publish as part of the same transition.
       *
       * Rides this write rather than following it, exactly as the feature twin
       * `markRevisionAsReviewRequested` does. A review-required draft cannot have a
       * dated schedule armed on its own (the schedule endpoint refuses one until
       * review is requested), so the client had to stage it locally and hope —
       * which meant the generic tab silently dropped it, because nothing sent it.
       */
      scheduledPublishAt?: Date | null;
      lockEdits?: boolean;
      lockOthers?: boolean;
    } = {},
  ) {
    // A date implies the armed flag, the same unification the feature twin makes.
    const dated = (scheduledPublishAt ?? null) !== null;
    const armed = !!autoPublishOnApproval || dated;

    // Both of the dedicated arm path's lock-others protections, which this write
    // had neither of: the friendly pre-check, and the index-conflict translation
    // below. Arming lock-others here while a sibling holds it otherwise surfaced a
    // raw E11000. The feature twin this flow was ported from
    // (`markRevisionAsReviewRequested`) catches the index conflict for exactly this
    // write — the port took the flow and left the conflict handling behind.
    if (dated && lockOthers) {
      const existing = await this.getById(id);
      if (existing) {
        await this.assertNoConflictingPublishLock(existing.target, id);
      }
    }
    // CAS-guarded on the fields the transition reads, like `recallReview` and
    // `undoReview`: an unguarded read-modify-write let a publish merge in between
    // and this write then demoted the merged revision to `pending-review`.
    const updated = await this.runTranslatingPublishLockConflict(() =>
      this.updateWithCas(
        id,
        // `target` because this verb's AUTHORITY is row-scoped: callers gate on
        // `canAdvanceRevision(target.snapshot)`, so a rebase that re-scopes the
        // revision changes the answer and must lose the race rather than ride it.
        // Same rule as `addReview` and `undoReview`. `armAcknowledgments` because the
        // callback reads it to decide whether to clear a stale fingerprint — a
        // concurrent arm's fresh set would otherwise survive a re-arm that should
        // have cleared it.
        // `reviewCycle` because this write computes the next one from the row it
        // read: a number stamped from a stale read moves the identity BACKWARDS onto
        // one an in-flight verdict already names. See `reviewCycle.ts`.
        [
          "status",
          "reviews",
          "activityLog",
          "target",
          "armAcknowledgments",
          "reviewCycle",
          // Read by the full advance proof's pure-revert arm.
          "revertedFrom",
        ],
        async (existing) => {
          await assertCasAuthority(authority, existing);
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
          return {
            status: "pending-review",
            reviewCycle: this.nextReviewCycle(existing),
            // Submitting (or re-submitting from changes-requested) starts a fresh
            // review cycle — demote any prior verdicts.
            reviews: this.staleVerdicts(existing.reviews),
            autoPublishOnApproval: armed,
            ...(dated
              ? {
                  scheduledPublishAt,
                  scheduledPublishLockEdits: !!lockEdits,
                  scheduledPublishLockOthers: !!lockOthers,
                }
              : {}),
            // The auto-publish runs with the arming user's authority. A stale
            // value from a previous cycle is harmless — `autoPublishOnApproval`
            // gates everything. `userId` is empty for API-key actors; skip so the
            // publish falls back to `authorId`.
            // Replaced, not conditionally set — see setAutoPublishOnApproval.
            autoPublishEnabledBy: armed && userId ? userId : null,
            // Arm-time guard fingerprints: set the new acknowledgments, or clear a
            // stale set from a prior arm (to {}) so a re-arm with no current conflicts
            // can't be covered by an outdated fingerprint.
            ...(armed &&
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
          } as UpdateProps<Revision>;
        },
      ),
    );
    if (!updated) throw new Error("Revision not found");

    // Submitting with the flag off must scrub any prior dated schedule + locks
    // (this.update can only flip the flag) — otherwise a later re-arm could
    // resurrect a stale schedule. Mirrors setAutoPublishOnApproval's disarm.
    // Read off the POST-CAS doc: the pre-image is what a concurrent arm made stale.
    if (
      !armed &&
      (updated.autoPublishOnApproval ||
        (updated.scheduledPublishAt ?? null) !== null)
    ) {
      const refreshed = await this.disarmScheduledPublish(id, {
        observed: updated,
      });
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
    // `status` on both paths: the check below reads it, and a terminal revision must
    // not be stamped with auto-publish state.
    //
    // ARMING additionally guards `target`, because `armAcknowledgments` fingerprints
    // `target.proposedChanges` and the fire-time drift check reads that fingerprint
    // as consent — so it must describe the content actually armed. Arming's AUTHORITY
    // is judged on the live entity, which is why `target` is otherwise irrelevant
    // here; disarming carries nothing content-derived and keeps the narrow guard.
    // `armAcknowledgments` on both paths: the compute READS it to decide whether a
    // stale fingerprint needs clearing, so a concurrent arm could otherwise pair one
    // actor's identity with another actor's acknowledgment.
    const guardFields: (keyof Revision)[] = enabled
      ? ["status", "target", "armAcknowledgments"]
      : ["status", "armAcknowledgments"];
    const updated = await this.updateWithCas(id, guardFields, (existing) => {
      if (
        !["draft", "pending-review", "changes-requested", "approved"].includes(
          existing.status,
        )
      ) {
        throw new Error(
          "Cannot change auto-publish on a published or discarded revision",
        );
      }

      // Auto-publish runs with the arming user's authority, so the identity is
      // REPLACED on every transition — never left behind. A conditional set meant an
      // identityless arm (API key, system actor) inherited whoever armed it last, and
      // the deferred publish then ran as that user. `null` clears it.
      return {
        autoPublishOnApproval: enabled,
        autoPublishEnabledBy: enabled && userId ? userId : null,
        // Arm-time guard fingerprints: set the new acknowledgments, or clear a
        // stale set from a prior arm (to {}) so a re-arm with no current
        // conflicts can't be covered by an outdated fingerprint.
        ...(enabled &&
        (hasArmAcknowledgments(armAcknowledgments) ||
          hasArmAcknowledgments(existing.armAcknowledgments))
          ? { armAcknowledgments: armAcknowledgments ?? {} }
          : {}),
      } as UpdateProps<Revision>;
    });
    if (!updated) throw new Error("Revision not found");

    // A fresh arm supersedes a prior schedule's parked failure — clear it so
    // the "Could not publish" notice doesn't persist next to a healthy arm
    // (the dated-schedule arm and disarm paths already do this).
    if (enabled && (updated.scheduledPublishGaveUpAt ?? null) !== null) {
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
      (updated.autoPublishOnApproval ||
        (updated.scheduledPublishAt ?? null) !== null)
    ) {
      const refreshed = await this.disarmScheduledPublish(id, {
        observed: updated,
      });
      if (refreshed) return refreshed;
    }

    return updated;
  }

  async addReview(
    id: string,
    userId: string,
    decision: ReviewDecision,
    comment: string,
    // Re-asked on the row every attempt — see `CasAuthority`.
    authority: CasAuthority<Revision>,
    // The review cycle this verdict was formed against, as the caller read it.
    // Status can't stand in for it: recall-then-resubmit returns the row to
    // `pending-review`, the value it already had, so a verdict aimed at the
    // retracted cycle satisfies every status check and lands on the new one —
    // approving changes nobody reviewed, and firing auto-publish on them.
    expectedReviewCycle?: number,
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

    // A comment is participation, not authority over the revision, so it is
    // authorized on its own terms below and skips the general update backstop.
    const isComment = decision === "comment";

    // CAS-guard every field the decision reads: `reviews`/`status`/`activityLog`
    // so a concurrent verdict can't be lost, `target` so a rebase that re-scopes
    // the revision loses the race instead of riding it, and `contributors` so an
    // edit landing between the check and the write can't slip past
    // blockSelfApproval (contributors are recorded by their own atomic write).
    const updated = await this.updateWithCas(
      id,
      // `reviewCycle` too: this write REFUSES on it (a verdict formed against a
      // superseded round), so it is a decision input like any other. Every cycle start
      // also moves `status` or `reviews`, so it is belt-and-braces — but the rule is
      // that the guard covers what the decision read, not what usually co-varies.
      [
        "reviews",
        "status",
        "activityLog",
        "target",
        "contributors",
        "reviewCycle",
      ],
      async (existing) => {
        if (isComment) this.assertCanWriteCommentOn(existing);
        else await assertCasAuthority(authority, existing);
        // Pinned to the caller's read, and re-asked on every CAS retry — the retry
        // is the dangerous one, because it re-reads a row that a recall AND a
        // resubmit may both have crossed since the first attempt. Comments are
        // exempt: they belong to the conversation, not to a cycle. Revisions
        // predating the field read as cycle 0, so a caller that also read 0 still
        // matches and nothing legacy is locked out.
        if (
          !isComment &&
          expectedReviewCycle !== undefined &&
          reviewCycleOf(existing) !== expectedReviewCycle
        ) {
          throw new Error(reviewCycleSupersededMessage("review"));
        }
        // Authoritative self-approval check, against the row this write is
        // conditioned on. Callers screen it first for a clean error, but a
        // caller's read is stale by the time it writes: a contributor entry can
        // land in between (editing records content and contributor separately),
        // and approving your own change is exactly what the setting forbids.
        if (
          decision === "approve" &&
          this.context.hasPremiumFeature("require-approvals") &&
          isUserBlockedFromApproving({
            settings: this.context.org.settings,
            entityType: existing.target.type,
            revision: existing,
            userId,
          })
        ) {
          throw new Error(
            "You contributed to this revision and cannot approve it.",
          );
        }
        // Re-checked under CAS: a verdict must not resurrect a revision that was
        // merged or discarded concurrently with this review.
        if (existing.status === "merged" || existing.status === "discarded") {
          throw new Error(`Cannot review a ${existing.status} revision`);
        }
        // ...nor one that left the review cycle. Refusing only the TERMINAL
        // statuses still admits `draft`, and a verdict written there sets
        // `approved`/`changes-requested` from the row's own status — so a recall
        // landing between the caller's read and this write had the retracted
        // cycle's verdict re-approve a revision nobody had asked to be reviewed.
        // Comments stay open: they carry no verdict and leave the status alone,
        // and commenting on a draft is ordinary.
        if (
          !isComment &&
          !(REVIEW_CYCLE_STATUSES as readonly string[]).includes(
            existing.status,
          )
        ) {
          throw new Error(
            `Can only submit a review when review has been requested (status is "${existing.status}")`,
          );
        }

        // Latest active (non-stale) verdict per reviewer; comments carry none.
        // Prior cycles' verdicts were demoted to stale at the reset (see
        // staleVerdicts), so they're history, not active approvals/blocks.
        const verdictByReviewer = new Map<string, ReviewDecision>();
        for (const r of [...existing.reviews, review]) {
          if (r.decision === "comment" || r.stale) continue;
          verdictByReviewer.set(r.userId, r.decision);
        }
        // Comments leave the status alone; otherwise the shared precedence rule
        // decides, with the row's current status as the fallback.
        const newStatus =
          decision === "comment"
            ? existing.status
            : statusFromStandingVerdicts(
                standingVerdicts(verdictByReviewer),
                existing.status,
              );

        return {
          reviews: [...existing.reviews, review],
          status: newStatus,
          activityLog: [
            ...this.cleanActivityLog(existing.activityLog),
            activityEntry,
          ],
        } as UpdateProps<Revision>;
      },
      { dangerouslyBypassCanUpdate: isComment },
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
      const refreshed = await this.disarmScheduledPublish(id, {
        observed: updated,
      });
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
  private async disarmScheduledPublish(
    id: string,
    // Set by `merge`/`close`, which have JUST resolved this row under their own
    // CAS and are scrubbing the spent schedule as part of that resolution. The
    // open-status condition below would refuse exactly those writes — it exists
    // for the lifecycle callers, where a concurrent publish/discard resolving the
    // revision mid-flight means the scrub would rewrite settled history.
    {
      rowResolvedByCaller = false,
      observed,
    }: {
      rowResolvedByCaller?: boolean;
      // The schedule fields as the caller's own CAS just left them. Without this
      // the scrub is a blind second write: an arm landing between the transition
      // and the scrub is erased, and its owner is told a schedule is set that no
      // longer exists. Guarded, a re-arm simply keeps the scrub from running —
      // which is right, because a schedule armed AFTER the disarm isn't stale.
      observed?: Revision;
    } = {},
  ): Promise<Revision | null> {
    await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        id,
        ...(rowResolvedByCaller
          ? {}
          : { status: { $nin: ["merged", "discarded"] } }),
        ...(observed
          ? buildCasGuard(
              // `status` and `reviews` as well as the schedule fields. The scrub is
              // authorized by a DECISION the caller's CAS just made ("this verdict is
              // changes-requested, so disarm"), and that decision read the status and
              // the verdicts — so both belong in the predicate. Guarding the schedule
              // alone let a newer approval land in the window, leaving its status and
              // verdicts untouched, and the older cleanup then cleared the schedule of
              // an approved revision.
              [
                "autoPublishOnApproval",
                "scheduledPublishAt",
                "status",
                "reviews",
              ],
              observed as unknown as Record<string, unknown>,
            )
          : {}),
      },
      {
        $set: { autoPublishOnApproval: false },
        $unset: { ...SCHEDULED_PUBLISH_UNSET, autoPublishEnabledBy: 1 },
      },
    );
    return this.getById(id);
  }

  // Recall / undo / comment-edit (review lifecycle)

  // Pull a review request back to draft. Clears reviews and disarms
  // auto-publish — recall restarts the lifecycle, so prior verdicts are no
  // longer active. Emits a "reopened" entry, which `addReview` uses as the
  // cycle-start marker (so any straggler verdicts are correctly treated as
  // pre-cycle history).
  async recallReview(
    id: string,
    userId: string,
    // Re-asked on the row every attempt — see `CasAuthority`.
    authority: CasAuthority<Revision>,
  ) {
    // CAS-guarded on `status`, which the check below reads. An unguarded write
    // let a publish merge between the read and the write, after which the recall
    // rewrote a MERGED revision back to `draft` and cleared its reviews — the
    // released change stayed live with its record demoted to an open draft.
    const updated = await this.updateWithCas(
      id,
      // `target` for the same reason as `submitForReview`: the non-author path is
      // gated on draft authority over `target.snapshot`.
      // `reviewCycle` because this write computes the next one from the row it
      // read: a number stamped from a stale read moves the identity BACKWARDS onto
      // one an in-flight verdict already names. See `reviewCycle.ts`.
      ["status", "reviews", "activityLog", "target", "reviewCycle"],
      async (existing) => {
        await assertCasAuthority(authority, existing);
        if (
          !["pending-review", "changes-requested", "approved"].includes(
            existing.status,
          )
        ) {
          throw new Error("Only a revision in review can be returned to draft");
        }
        return {
          status: "draft",
          reviews: [],
          reviewCycle: this.nextReviewCycle(existing),
          autoPublishOnApproval: false,
          activityLog: [
            ...this.cleanActivityLog(existing.activityLog),
            {
              id: uniqid("act_"),
              userId,
              action: "recalled",
              description: "Recalled review request — returned to draft",
              dateCreated: new Date(),
            },
          ],
        } as UpdateProps<Revision>;
      },
    );
    if (!updated) throw new Error("Revision not found");

    // this.update can't $unset, so clear any pending dated schedule + locks in a
    // follow-up raw write — otherwise a stale scheduledPublishAt could fire on a
    // later re-arm before a new review cycle completes. Read off the POST-CAS doc:
    // the pre-image is what a concurrent re-arm would have made stale.
    if (
      updated.autoPublishOnApproval ||
      (updated.scheduledPublishAt ?? null) !== null
    ) {
      const refreshed = await this.disarmScheduledPublish(id, {
        observed: updated,
      });
      if (refreshed) return refreshed;
    }
    return updated;
  }

  // Retract the calling user's own active verdict in the current review cycle.
  // Unlike recall, this must NOT reset the cycle — other reviewers' verdicts
  // survive — so it logs a "review-retracted" entry (not a cycle-start action)
  // and recomputes status from the remaining active verdicts.
  //
  // Guarded and re-authorized exactly like `addReview`: `target` is in the guard so
  // a rebase that re-scopes the revision loses the race instead of riding it, and
  // `authority` re-asks the caller's question against the row this write is
  // conditioned on. Without both, a rebase could move the revision into a project
  // the caller holds nothing in and the retraction would still land.
  async undoReview(
    id: string,
    userId: string,
    authority: CasAuthority<Revision>,
    // The review cycle the retraction was aimed at, for the same reason
    // `addReview` takes one — and the reasoning is symmetric. A verdict must not
    // cross a recall/resubmit; neither must its withdrawal. This reviewer's verdict
    // on the NEW cycle looks exactly like their verdict on the retracted one, so an
    // undo in flight across the boundary removes a verdict its sender never saw,
    // and dropping a `changes-requested` can resolve the revision to `approved` and
    // fire auto-publish on changes nobody cleared.
    expectedReviewCycle?: number,
  ) {
    const updated = await this.updateWithCas(
      id,
      // `reviewCycle` for the same reason as `addReview`: this write REFUSES on it,
      // so it is a decision input and belongs in the predicate.
      ["reviews", "status", "activityLog", "target", "reviewCycle"],
      async (existing) => {
        await assertCasAuthority(authority, existing);
        if (
          expectedReviewCycle !== undefined &&
          reviewCycleOf(existing) !== expectedReviewCycle
        ) {
          throw new Error(reviewCycleSupersededMessage("retraction"));
        }
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
        const newStatus = statusFromStandingVerdicts(
          standingVerdicts(verdictByReviewer),
          "pending-review",
        );

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
   * undoReview). Does not touch status, but IS guarded on it: the callback below
   * refuses a merged or discarded revision, and a guard that omitted status let a
   * publish or discard land between that read and this write.
   */
  // Standing to write a comment on a revision. Comment writes get their own
  // check because the general update backstop recognizes only authors and
  // draft/review/revert/publish authority, which locks out a user whose claim
  // is the addComments atom. Called INSIDE the CAS callback so it reads the
  // same document the write is conditioned on — a concurrent rebase that moves
  // the target's project can't slip between the check and the write.
  private assertCanWriteCommentOn(existing: Revision): void {
    if (isRevisionAuthor(existing.authorId, this.context.userId)) return;
    if (
      !canCommentOnRevision(
        existing.target.type,
        this.context,
        existing.target.snapshot as Record<string, unknown>,
      )
    ) {
      this.context.permissions.throwPermissionError();
    }
  }

  async editComment(
    id: string,
    reviewId: string,
    userId: string,
    comment: string,
    authority: CasAuthority<Revision>,
  ) {
    const updated = await this.updateWithCas(
      id,
      ["reviews", "status", "target"],
      async (existing) => {
        await assertCasAuthority(authority, existing);
        this.assertCanWriteCommentOn(existing);
        if (existing.status === "merged" || existing.status === "discarded") {
          throw new Error(
            "Cannot edit a comment on a merged or discarded revision",
          );
        }
        const idx = existing.reviews.findIndex((r) => r.id === reviewId);
        if (idx < 0) throw new Error("Comment not found");
        const entry = existing.reviews[idx];
        // A reviewer may rewrite the text on their own verdict; the decision
        // itself stays immutable (only `comment` is reassigned below), and
        // deletion is still restricted to plain comments. Matches
        // FeatureRevisionLogModel's EDITABLE_AUTHOR_ACTIONS, which the shared
        // timeline's Edit affordance is built against.
        if (entry.userId !== userId) {
          throw new Error("You can only edit your own comment");
        }
        const newReviews = [...existing.reviews];
        newReviews[idx] = { ...entry, comment };
        return { reviews: newReviews } as UpdateProps<Revision>;
      },
      { dangerouslyBypassCanUpdate: true },
    );
    if (!updated) throw new Error("Revision not found");
    return updated;
  }

  /** Delete a comment the calling user authored. Only "comment" reviews. */
  async deleteComment(
    id: string,
    reviewId: string,
    userId: string,
    authority: CasAuthority<Revision>,
  ) {
    const updated = await this.updateWithCas(
      id,
      ["reviews", "status", "target"],
      async (existing) => {
        await assertCasAuthority(authority, existing);
        this.assertCanWriteCommentOn(existing);
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
      },
      { dangerouslyBypassCanUpdate: true },
    );
    if (!updated) throw new Error("Revision not found");
    return updated;
  }

  // Proposed changes

  async updateProposedChanges(
    id: string,
    proposedChanges: JsonPatchOperation[],
    userId: string,
    authority: CasAuthority<Revision>,
  ) {
    this.assertSupportedPatchOps(proposedChanges);

    // Live-entity basis, so this resolves the same set of revisions the handler and
    // `createOrUpdateRevision` do — check and write disagreeing about which
    // revisions EXIST is how the silent-fork bug happened one layer up.
    const existing = await this.getByIdReadable(id);
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

    return this.writeContentEdit(id, userId, authority, (row) => ({
      target: {
        ...row.target,
        snapshot: getAdapter(row.target.type).buildSnapshot(
          row.target.snapshot as Record<string, unknown>,
        ) as typeof row.target.snapshot,
        proposedChanges,
      } as Revision["target"],
      entry: {
        id: uniqid("act_"),
        userId,
        action: "updated",
        description: "Updated proposed changes",
        dateCreated: new Date(),
        // Persist the cumulative proposed-changes state as of this edit so the UI
        // can diff it against the previous entry's snapshot and show exactly what
        // this particular edit changed.
        proposedChangesSnapshot: proposedChanges,
      },
    }));
  }

  /**
   * A content edit to a draft: its new target and activity entry, written
   * together with the editor's contributor record.
   *
   * One CAS'd write, guarded on `contributors`. As two writes, an approval could
   * land in between and see no contributor — exactly what `blockSelfApproval`
   * exists to prevent. Guarding on the field also means a concurrent editor
   * causes a retry rather than being dropped from the array, which is why the
   * separate `$addToSet` existed in the first place.
   *
   * `build` runs inside the CAS compute, so the snapshot, the approval reset and
   * the activity log are all derived from the row the write is conditioned on.
   */
  private async writeContentEdit(
    id: string,
    userId: string,
    authority: CasAuthority<Revision>,
    build: (existing: Revision) => {
      target: Revision["target"];
      entry: Revision["activityLog"][number];
    },
  ): Promise<Revision> {
    const updated = await this.updateWithCas(
      id,
      // Every field this write READS or OVERWRITES, not just `contributors`. Guarding
      // the contributor list alone let a concurrent publish — which changes `status`
      // without necessarily touching contributors — slip past: the stale edit still
      // matched and rewrote merged history, including the status and reviews the
      // publish had just set. `assertDraftAcceptsContentEdit` is re-checked inside the
      // loop, so a retry sees the new status and refuses properly.
      // `reviewCycle` because this write computes the next one from the row it
      // read: a number stamped from a stale read moves the identity BACKWARDS onto
      // one an in-flight verdict already names. See `reviewCycle.ts`.
      [
        "contributors",
        "status",
        "target",
        "reviews",
        "activityLog",
        "reviewCycle",
        // Read by the edit-lock refusal: a lock armed between the read and the write
        // must make this attempt lose rather than let the edit land on a locked draft.
        "scheduledPublishLockEdits",
        // Read by the full advance proof: the pure-revert arm asks what this draft
        // reverts, so a concurrent change to it changes the authority answer.
        "revertedFrom",
      ],
      async (existing) => {
        await assertCasAuthority(authority, existing);
        this.assertDraftAcceptsContentEdit(existing);
        const { target, entry } = build(existing);
        const { status, resetEntry } = this.resetApprovalIfNeeded(
          existing,
          userId,
        );
        return {
          target,
          // An approval reset starts a new cycle — demote the prior verdicts.
          ...(status
            ? {
                status,
                reviews: this.staleVerdicts(existing.reviews),
                reviewCycle: this.nextReviewCycle(existing),
              }
            : {}),
          activityLog: [
            ...this.cleanActivityLog(existing.activityLog),
            entry,
            ...(resetEntry ? [resetEntry] : []),
          ],
          contributors: this.withContributor(existing.contributors, userId),
        } as UpdateProps<Revision>;
      },
    );
    if (!updated) throw new Error("Revision not found");
    return updated;
  }

  // Re-checked inside the CAS compute as well as by the callers, which raise the
  // clearer error: the caller's read is stale by the time the write lands, and a
  // draft that got merged or schedule-locked in between must not take the edit.
  private assertDraftAcceptsContentEdit(existing: Revision): void {
    if (existing.status === "discarded" || existing.status === "merged") {
      throw new Error(
        "Cannot update proposed changes on a discarded or merged revision",
      );
    }
    if (isRevisionEditLockedBySchedule(existing)) {
      throw new Error(
        "This draft is locked for a scheduled publish. Cancel the schedule before editing.",
      );
    }
  }

  async rebase(
    id: string,
    newSnapshot: Record<string, unknown>,
    newProposedChanges: JsonPatchOperation[],
    userId: string,
    authority: CasAuthority<Revision>,
  ) {
    const existing = await this.getById(id);
    if (!existing) throw new Error("Revision not found");

    const cleanedSnapshot = getAdapter(existing.target.type).buildSnapshot(
      newSnapshot as Record<string, unknown>,
    );

    return this.writeContentEdit(id, userId, authority, (row) => ({
      target: {
        ...row.target,
        snapshot: cleanedSnapshot as typeof row.target.snapshot,
        proposedChanges: newProposedChanges,
      } as Revision["target"],
      entry: {
        id: uniqid("act_"),
        userId,
        action: "updated" as const,
        description: "Rebased revision on current live state",
        dateCreated: new Date(),
        // Rebase shifts both the baseline snapshot and the proposed changes.
        // Persist both so the UI can reconstruct the state on either side of the
        // rebase for a meaningful per-entry diff.
        proposedChangesSnapshot: newProposedChanges,
        targetSnapshot: cleanedSnapshot,
      },
    }));
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
      // Plan-time baseline for bulk: the claim fails if the revision was touched AT
      // ALL since planning, not just if its status moved — `dateUpdated` rides the
      // guard fields so a same-status edit trips the CAS retry. Conflicts throw
      // ConflictError so callers can tell a lost race from an infra failure.
      expected?: { status: string; dateUpdated: Date };
    },
  ) {
    // Whether a schedule was armed on the winning CAS read — used after the
    // status transition lands to scrub the schedule fields.
    let hadSchedule = false;
    // `target` because the caller computed `desiredState` from this revision's
    // proposed changes BEFORE calling merge. A CAS must guard every field the
    // computation it protects actually read — otherwise a concurrent edit that keeps
    // the status rewrites the content and live receives the stale version.
    const target = await this._dangerousGetCollection().findOne(
      { organization: this.context.org.id, id },
      { projection: { "target.type": 1, "target.id": 1 } },
    );
    // `activityLog` and the schedule fields because the merge appends an entry to
    // the log it read and decides the scrub from the schedule it read — the same
    // rule the guard-completeness check enforces everywhere else.
    const guardFields: (keyof Revision)[] = options?.expected
      ? [
          "status",
          "dateUpdated",
          "target",
          "activityLog",
          "autoPublishOnApproval",
          "scheduledPublishAt",
        ]
      : [
          "status",
          "target",
          "activityLog",
          "autoPublishOnApproval",
          "scheduledPublishAt",
        ];
    const merged = await this.updateWithCas(
      id,
      guardFields,
      async (existing) => {
        // Re-derived per attempt, not once before the loop: a rival that merged
        // during our retry window would otherwise leave us stamping a value equal to
        // or behind theirs, and merge ORDER is what every landing baseline reads. A
        // read is side-effect free, so it is safe to repeat.
        const mergeStamp = target
          ? await this.nextMergeStamp(
              target.target.type as RevisionTargetType,
              target.target.id as string,
            )
          : new Date();
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
            dateCreated: mergeStamp,
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
      },
    );
    if (!merged) throw new Error("Revision not found");

    // Fully scrub the schedule fields on publish (this.update can't $unset),
    // matching the feature flow's markRevisionAsPublished.
    if (hadSchedule) {
      const refreshed = await this.disarmScheduledPublish(id, {
        rowResolvedByCaller: true,
      });
      if (refreshed) return refreshed;
    }
    return merged;
  }

  async close(
    id: string,
    userId: string,
    authority: CasAuthority<Revision>,
    reason?: string,
  ) {
    let hadSchedule = false;
    const closed = await this.updateWithCas(
      id,
      // The schedule fields because `hadSchedule` — which decides the scrub below —
      // is computed from them, and `activityLog` because the entry is appended to the
      // log this read returned. Guarding `status` alone left both to a stale read.
      // `target` because the discard authority judges on `target.snapshot`.
      [
        "status",
        "autoPublishOnApproval",
        "scheduledPublishAt",
        "activityLog",
        "target",
      ],
      async (existing) => {
        await assertCasAuthority(authority, existing);
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
      },
    );
    if (!closed) throw new Error("Revision not found");

    // Fully scrub the schedule fields on discard (this.update can't $unset),
    // matching the feature flow.
    if (hadSchedule) {
      const refreshed = await this.disarmScheduledPublish(id, {
        rowResolvedByCaller: true,
      });
      if (refreshed) return refreshed;
    }
    return closed;
  }

  // Roll a just-merged revision back after applyChanges failed. Unlike `reopen` it
  // restores the prior status, re-arms the schedule `merge` scrubbed (else a fire-time
  // failure kills it instead of retrying), and restores the guard acknowledgment.
  //
  // Guarded raw write: applies only while the doc is still "merged" from this
  // failed publish. `expectedDateUpdated` pins it to that exact merge, so a
  // concurrent reopen-and-republish is not clobbered.
  async reopenAfterFailedApply(
    id: string,
    userId: string,
    prior: Revision,
    expectedDateUpdated?: Date | null,
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
      ...(expectedDateUpdated ? { dateUpdated: expectedDateUpdated } : {}),
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

  async reopen(id: string, userId: string, authority: CasAuthority<Revision>) {
    // Always reopen into `draft`. A discarded revision may have been in any
    // pre-resolution status (draft, pending-review, changes-requested,
    // approved); landing in `pending-review` can force the author through a
    // review cycle for a revision that was never submitted. Reopening to
    // `draft` lets the author explicitly re-submit via `submitForReview`
    // when ready — a safer default than inferring the pre-discard status.
    // `reviewCycle` because this write computes the next one from the row it
    // read: a number stamped from a stale read moves the identity BACKWARDS onto
    // one an in-flight verdict already names. See `reviewCycle.ts`.
    const reopened = await this.updateWithCas(
      id,
      // `reviews` and `activityLog` because this write REWRITES both wholesale from
      // what it read (stale verdicts, cleaned log + a new entry). Unguarded, a review
      // or an entry landing in between is silently dropped.
      // `target` because the authority check judges on `target.snapshot`: a rebase
      // that re-scopes the revision changes that answer, so it must be part of the
      // predicate. Every verb taking a row-scoped authority owes this.
      ["status", "reviewCycle", "reviews", "activityLog", "target"],
      async (existing) => {
        await assertCasAuthority(authority, existing);
        // Re-checked under the CAS, against the row this write is conditioned on:
        // the guard alone only proves `status` hasn't changed since the CAS re-read,
        // and a retry re-reads. Without this a reopen racing a publish could demote
        // MERGED history back to `draft`. Only a discarded revision reopens.
        if (existing.status !== "discarded") return null;
        return {
          status: "draft",
          resolution: undefined,
          // Reopening restarts the lifecycle — demote any pre-discard verdicts.
          reviews: this.staleVerdicts(existing.reviews),
          reviewCycle: this.nextReviewCycle(existing),
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
      },
    );
    // `updateWithCas` returns null for a missing row AND for a compute that refused,
    // so reporting "not found" told the loser of a two-operator race that the revision
    // does not exist. Re-read on the failure path only, to say which it was.
    if (!reopened) {
      const existing = await this.getById(id);
      if (!existing) throw new Error("Revision not found");
      throw new Error(
        `Only a discarded revision can be reopened (this one is "${existing.status}").`,
      );
    }
    return reopened;
  }

  // Scheduled / deferred publish

  // Arm (or cancel) a deferred publish on a revision. Scheduling implies the
  // armed auto-publish flag; canceling disarms it. The publish later runs with
  // `enabledBy`'s authority (falls back to the draft author when null).
  //
  // Uses a raw, status-guarded write so a revision published/discarded between
  // the caller's read and this write can't get schedule fields stamped back on
  // (which would also leave a stale lock-others doc occupying the partial unique
  // index). Permission gating therefore happens in the controller.
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
      // Status-guarded like the arm below, and for the same reason: a revision
      // published or discarded between the read above and this write is no longer
      // ours to touch. Cancelling one anyway rewrote terminal history and bumped
      // `dateUpdated`, which is the stamp a failed landing's recovery compares —
      // so a stray cancel could make that recovery disown its own merge.
      await coll.updateOne(
        { ...filter, status: { $in: [...ACTIVE_DRAFT_STATUSES] } },
        {
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
        },
      );
      // No throw when the guard misses, unlike the arm below: the schedule the
      // caller wanted withdrawn has already run or been thrown away, which is the
      // outcome they asked for. Same disposition as the already-disarmed no-op
      // above — the returned doc tells them where it actually landed.
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
      // Guard against a TOCTOU race: only arm a revision that's still active AND
      // still holding the content this arm was computed against.
      //
      // `armAcknowledgments` is a fingerprint of `target.proposedChanges`, and the
      // fire-time drift check reads it as consent — so content changing between the
      // read above and this write armed a schedule whose fingerprint describes
      // changes nobody acknowledged. Same defect the auto-publish arm had; this is
      // its dated twin.
      //
      // Guarded on `dateUpdated` rather than on `target` itself: any write that
      // touches the target bumps it, and it is a scalar. An embedded-document
      // equality on `target` is field-order sensitive, which is what made an earlier
      // guard here permanently unsatisfiable (see `buildCasGuard`).
      const { matchedCount } = await coll.updateOne(
        {
          ...filter,
          status: { $in: [...ACTIVE_DRAFT_STATUSES] },
          dateUpdated: existing.dateUpdated,
        },
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
        // Covers both guards: a revision that left the active statuses, and one
        // whose content moved since this arm was computed.
        throw new Error(
          "This revision can no longer be scheduled — it was published, discarded, or edited while you were scheduling it.",
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
  /**
   * Turn the `uniqueArmedPublishLockOthers` index conflict into the same friendly
   * message the dedicated arm path produces.
   *
   * The pre-check above is the common case; this is the race that beats it. Both
   * exist on `setScheduledPublish`, and both were missing from the arm inside
   * `submitForReview`, so a lost race there surfaced a raw E11000 duplicate-key
   * error to the caller.
   */
  private async runTranslatingPublishLockConflict<T>(
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isPublishLockIndexConflict(e)) {
        throw new Error(PUBLISH_LOCK_CONFLICT_MESSAGE);
      }
      throw e;
    }
  }

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

  // True if another revision has a committed "lock other drafts" schedule
  // blocking sibling publishes. Only applies once committed and no longer
  // awaiting approval — status "approved" (approval flow) or "draft"
  // (no-approval flow). Used by publishRevision before merging.
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

  // Record a failed poller attempt so a stuck schedule is visible instead of
  // silently retrying. Intentionally a raw write — no dateUpdated bump, audit,
  // timeline, or webhook — so per-tick retries don't generate noise. Returns the
  // new attempt count.
  async recordScheduledPublishFailure(
    id: string,
    message: string,
    // The schedule this attempt was acting on. See the feature twin: without the
    // condition a stale worker can stamp an error on a revision a concurrent publish
    // already closed, and the caller emits a false `revision.publishFailed`.
    expectedScheduledPublishAt?: Date | null,
  ): Promise<number> {
    const doc = await this._dangerousGetCollection().findOneAndUpdate(
      {
        organization: this.context.org.id,
        id,
        status: { $nin: ["merged", "discarded"] },
        ...(expectedScheduledPublishAt !== undefined
          ? { scheduledPublishAt: expectedScheduledPublishAt }
          : {}),
      },
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
    // The ARM this attempt was working on, like `parkScheduledPublish`. Without it a
    // user who cancels and re-arms while a failing attempt is in flight has their new
    // schedule delayed by the old attempt's backoff.
    expectedScheduledPublishAt?: Date | null,
  ): Promise<void> {
    await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        id,
        ...(expectedScheduledPublishAt !== undefined
          ? { scheduledPublishAt: expectedScheduledPublishAt }
          : {}),
      },
      { $set: { scheduledPublishNextAttemptAt: nextAttemptAt } },
    );
  }

  // Give up on a failing scheduled publish: clear the schedule (so the poller
  // stops selecting it), disarm auto-publish, and stamp `scheduledPublishGaveUpAt`
  // so the UI can flag the abandoned schedule. The draft is left open (status
  // unchanged) with `scheduledPublishLastError` preserved for context. Raw write
  // (no audit / dateUpdated bump), like the failure recorder — the
  // `revision.publishFailed` webhook is the user-facing signal.
  async parkScheduledPublish(
    id: string,
    // The ARM the poller was working on. Without it, a user who cancels and
    // re-arms while a failing attempt is in flight has their new schedule cleared
    // when the old attempt gives up. `null` matches a missing field.
    expectedScheduledPublishAt: Date | null,
    // Returns whether the park took effect. A no-op means the revision moved on —
    // published, or re-armed — so the caller must not report a failure for it.
  ): Promise<boolean> {
    const res = await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        id,
        scheduledPublishAt: expectedScheduledPublishAt,
      },
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
    return res.matchedCount > 0;
  }

  // Cross-org poller query for the Agenda job: every armed revision whose date
  // has arrived and is still in an active review cycle. Org-agnostic by design
  // (context is resolved per-org downstream), so this is a static that hits the
  // collection directly rather than going through the org-scoped instance.
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
    // Live-entity basis, like every other listing: a `canRead` over the snapshot
    // would hide a moved entity's history from the project that now owns it while
    // showing it to the one that no longer does.
    const readable = await this.readableTargetIds([
      { type: entityType, id: entityId },
    ]);
    if (!readable.has(`${entityType}:${entityId}`)) return [];
    return this._find(
      {
        "target.type": entityType,
        "target.id": entityId,
        status: "merged",
      } as Record<string, unknown>,
      { bypassReadPermissionChecks: true },
    );
  }

  // Beacon: lightweight query returning just target IDs with open revisions

  async getOpenRevisionTargetIds(
    entityType: RevisionTargetType,
  ): Promise<string[]> {
    // A bare `distinct` over target IDs would hand back the keys of entities the
    // caller cannot read. Readability is decided on the LIVE entity, like every
    // other listing — the snapshot records where the entity was when the draft
    // opened, so a snapshot-basis beacon lit up for the project that no longer
    // owns it and stayed dark for the one that does. Only target ids are projected
    // here; the live scopes come from one batched lookup per entity type.
    const docs = await this._dangerousGetCollection()
      .find(
        {
          organization: this.context.org.id,
          "target.type": entityType,
          status: { $nin: ["merged", "discarded"] },
        },
        { projection: { "target.type": 1, "target.id": 1 } },
      )
      .toArray();

    const ids = new Set<string>();
    for (const doc of docs) {
      if (doc?.target?.id) ids.add(doc.target.id as string);
    }
    if (!ids.size) return [];
    const readable = await this.readableTargetIds(
      [...ids].map((id) => ({ type: entityType, id })),
    );
    return [...ids].filter((id) => readable.has(`${entityType}:${id}`));
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

    // Read-filtered on the LIVE entity, like the beacon one method over. Without
    // it, calling this with no ids — which the draft-state hook does — returned
    // every entity id in the org plus its draft activity, to any authenticated
    // member. One batched projected lookup, not a fetch per row.
    const seen = new Set<string>();
    for (const doc of docs) {
      const entityId = doc.target?.id as string;
      if (entityId) seen.add(entityId);
    }
    if (!seen.size) return {};
    const readable = await this.readableTargetIds(
      [...seen].map((id) => ({ type, id })),
    );

    const result: Record<
      string,
      Partial<Record<ActiveDraftStatus, number>>
    > = {};
    for (const doc of docs) {
      const entityId = doc.target?.id as string;
      const status = doc.status as ActiveDraftStatus;
      if (!entityId) continue;
      if (!readable.has(`${type}:${entityId}`)) continue;
      if (!result[entityId]) result[entityId] = {};
      result[entityId][status] = (result[entityId][status] ?? 0) + 1;
    }
    return result;
  }

  // A revision created already `merged`, in one write. Two writes (create then merge)
  // strand the draft if the merge fails after the entity was updated — it can never be
  // published, since there are then "no changes" against live. Callers must persist the live entity change
  // *before* calling this so the merged revision is a faithful record of a
  // change that has actually landed.
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
    // Strictly after this target's previous merge — see nextMergeStamp. A direct
    // landing records its merge here, and "latest merged" has to order it after
    // whatever landed before it even inside the same millisecond.
    const now = await this.nextMergeStamp(params.type, params.id);

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
