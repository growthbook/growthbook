import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionLogInterface,
  featureRevisionLogValidator,
} from "back-end/src/validators/feature-revision-log";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "featurerevisionlog";

// Author-editable entries: authors can rewrite the comment text on their own
// entries for these actions. Verdicts (Approved / Requested Changes) are
// editable too, but only `value.comment` changes — the action stays immutable.
// To retract a verdict outright, use `undoReview`.
const EDITABLE_AUTHOR_ACTIONS = new Set([
  "Comment",
  "Approved",
  "Requested Changes",
]);

// Author-deletable entries: deletion is restricted to plain "Comment"
// entries to preserve the audit trail. Deleting a verdict would orphan its
// effect on the revision's status — use `undoReview` for that.
const DELETABLE_AUTHOR_ACTIONS = new Set(["Comment"]);

const BaseClass = MakeModelClass({
  schema: featureRevisionLogValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "frl_",
  auditLog: {
    entity: "featureRevisionLog",
    createEvent: "featureRevisionLog.create",
    updateEvent: "featureRevisionLog.update",
    deleteEvent: "featureRevisionLog.delete",
  },
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        featureId: 1,
        version: 1,
      },
    },
  ],
});

export class FeatureRevisionLogModel extends BaseClass {
  protected canRead(doc: FeatureRevisionLogInterface): boolean {
    const { feature } = this.getForeignRefs(doc);

    return this.context.permissions.canReadSingleProjectResource(
      feature?.project,
    );
  }

  protected canCreate(doc: FeatureRevisionLogInterface): boolean {
    const { feature } = this.getForeignRefs(doc);
    if (!feature) {
      throw new Error("Feature not found for FeatureRevisionLog");
    }
    return (
      this.context.permissions.canCreateFeature(feature) ||
      this.context.permissions.canManageFeatureDrafts(feature)
    );
  }

  // Owner check shared by update / delete. Action membership is checked by
  // the specific protected method to allow different edit vs delete policies.
  private isOwnedEntry(doc: FeatureRevisionLogInterface): boolean {
    const docUserId = doc.user && "id" in doc.user ? doc.user.id : null;
    if (!docUserId) return false;
    return this.context.userId === docUserId;
  }

  protected canUpdate(existing: FeatureRevisionLogInterface): boolean {
    if (!EDITABLE_AUTHOR_ACTIONS.has(existing.action)) return false;
    return this.isOwnedEntry(existing);
  }

  protected canDelete(existing: FeatureRevisionLogInterface): boolean {
    if (!DELETABLE_AUTHOR_ACTIONS.has(existing.action)) return false;
    return this.isOwnedEntry(existing);
  }

  public async getAllByFeatureIdAndVersion({
    featureId,
    version,
  }: {
    featureId: string;
    version: number;
  }) {
    return await this._find({ featureId, version });
  }

  // The route addresses an entry as feature/version/logId, but the document
  // lookup is by logId alone — verify the entry actually belongs to the
  // feature+revision in the URL so callers can't mutate entries on other
  // features they happen to own comments on.
  private assertEntryInScope(
    existing: FeatureRevisionLogInterface,
    scope: { featureId: string; version: number },
  ): void {
    if (
      existing.featureId !== scope.featureId ||
      existing.version !== scope.version
    ) {
      throw new Error("Could not find revision log entry");
    }
  }

  // Update only the `comment` field inside a log entry's `value` JSON. Keeps
  // the action/verdict intact so verdict-bearing entries (Approved, Requested
  // Changes) retain their semantics — only the comment text changes.
  public async updateCommentText(
    id: string,
    newComment: string,
    scope: { featureId: string; version: number },
  ) {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error("Could not find revision log entry");
    }
    this.assertEntryInScope(existing, scope);
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(existing.value);
      if (parsed && typeof parsed === "object") {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      // The value wasn't structured JSON; treat as bare comment.
    }
    payload.comment = newComment;
    return await this.updateById(id, {
      value: JSON.stringify(payload),
    });
  }

  // Delete an owned plain-comment entry. Verdict entries are not deletable
  // here — to retract a verdict, callers should use the `undoReview` flow.
  public async deleteOwnedEntry(
    id: string,
    scope: { featureId: string; version: number },
  ) {
    const existing = await this.getById(id);
    if (!existing) return undefined;
    this.assertEntryInScope(existing, scope);
    await this.delete(existing);
    return existing;
  }

  public async deleteAllByFeature(feature: FeatureInterface) {
    // We should keep the log unless the feature itself is deleted.
    if (!this.context.permissions.canDeleteFeature(feature)) {
      throw new Error("You do not have access to delete this resource");
    }

    return await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      featureId: feature.id,
    });
  }
}
