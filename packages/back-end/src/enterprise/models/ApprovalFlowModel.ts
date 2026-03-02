import uniqid from "uniqid";
import { approvalFlowValidator, ApprovalFlow } from "shared/enterprise";
import { MakeModelClass } from "back-end/src/models/BaseModel";

export const COLLECTION_NAME = "approvalflows";

const BaseClass = MakeModelClass({
  schema: approvalFlowValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "af_",
  auditLog: {
    entity: "approvalFlow",
    createEvent: "approvalFlow.create",
    updateEvent: "approvalFlow.update",
    deleteEvent: "approvalFlow.delete",
  },
  globallyUniqueIds: true,
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
  ],
});

export class ApprovalFlowModel extends BaseClass {
  protected canRead(_doc: ApprovalFlow): boolean {
    // TODO: Should this inherit same permissions from target ?
    return true;
  }

  protected canCreate(_doc: ApprovalFlow): boolean {
    return this.context.hasPremiumFeature("require-approvals");
  }

  protected canUpdate(
    _existing: ApprovalFlow,
    _updates: ApprovalFlow,
  ): boolean {
    return true;
  }

  protected canDelete(doc: ApprovalFlow): boolean {
    // Author or admins can delete an approval flow
    // FIXME: We cannot check only the first index. Figure out proper permission check.
    return (
      doc.authorId === this.context.userId ||
      this.context.permissions.canBypassApprovalChecks({
        project: doc.target.snapshot.projects?.[0],
      })
    );
  }

  protected async beforeCreate(doc: ApprovalFlow) {
    if (!doc.activityLog || doc.activityLog.length === 0) {
      doc.activityLog = [
        {
          id: uniqid("act_"),
          userId: doc.authorId,
          action: "created",
          description: `Created approval flow for ${doc.target.type}: ${doc.target.id}`,
          dateCreated: doc.dateCreated,
        },
      ];
    }
  }
}
