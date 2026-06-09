import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionLogInterface,
  featureRevisionLogValidator,
} from "back-end/src/validators/feature-revision-log";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "featurerevisionlog";

// Author-managed entries: an author can edit / delete their own log entries
// for these actions. Restricted to plain "Comment" entries to preserve the
// audit-trail integrity of verdicts (Approved / Requested Changes), review
// requests, and other system-generated events. To retract a verdict, use the
// `undoReview` flow; to retract a review request, use `recallReview`.
const AUTHOR_MANAGED_ACTIONS = new Set(["Comment"]);

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

  // Owners can edit the comment text in / delete their own author-managed
  // entries. All other entries remain immutable as audit-trail records.
  private isOwnedAuthorManagedEntry(
    doc: FeatureRevisionLogInterface,
  ): boolean {
    if (!AUTHOR_MANAGED_ACTIONS.has(doc.action)) return false;
    const docUserId = doc.user && "id" in doc.user ? doc.user.id : null;
    if (!docUserId) return false;
    return this.context.userId === docUserId;
  }

  protected canUpdate(existing: FeatureRevisionLogInterface): boolean {
    return this.isOwnedAuthorManagedEntry(existing);
  }

  protected canDelete(existing: FeatureRevisionLogInterface): boolean {
    return this.isOwnedAuthorManagedEntry(existing);
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

  // Update only the `comment` field inside a log entry's `value` JSON. Keeps
  // the action/verdict intact so verdict-bearing entries (Approved, Requested
  // Changes) retain their semantics — only the comment text changes.
  public async updateCommentText(id: string, newComment: string) {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error("Could not find revision log entry");
    }
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

  // Delete an owned author-managed entry. Note that deletion of a verdict
  // entry (Approved / Requested Changes) does NOT recompute the revision's
  // `status` field — callers wanting to retract a verdict should use the
  // `undoReview` flow instead.
  public async deleteOwnedEntry(id: string) {
    const existing = await this.getById(id);
    if (!existing) return undefined;
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
