import type { Revision, RevisionTargetType } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import type { EntityRevisionAdapter } from "back-end/src/revisions/EntityRevisionAdapter";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { isRevisionDiverged } from "back-end/src/revisions/util";

/**
 * The approval-required and stale-base publish gates for any entity on the
 * generic revision system — the single implementation behind both the
 * single-entity REST publish handlers and the bulk publisher. Approval
 * scoping stays per-adapter (`isApprovalRequiredForRevision`); this collector
 * must never flatten it into an org-level check. Features are deliberately
 * NOT served here — their gates live in services/featurePublishGates.ts.
 */
export function collectRevisionGovernanceGates({
  context,
  adapter,
  targetType,
  entity,
  revision,
}: {
  context: Context;
  adapter: EntityRevisionAdapter;
  targetType: RevisionTargetType;
  entity: Record<string, unknown>;
  revision: Revision;
}): PublishGate[] {
  const gates: PublishGate[] = [];
  // The revision-route base for gate resolutions, per the entity's REST
  // identifier convention (configs/constants by key, saved groups by id).
  const identifier =
    (entity as { key?: string }).key ?? (entity as { id: string }).id;
  const routeBase = `/${targetType}s-revisions/${identifier}/${revision.version}`;

  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(context, revision)
    : adapter.isApprovalRequired(context);
  if (approvalRequired && revision.status !== "approved") {
    gates.push({
      type: "approval-required",
      severity: "blocker",
      messages: [
        `Requires approval before publishing (status: "${revision.status}").`,
      ],
      override: null,
      requiresPermission: "bypassApprovalChecks",
      resolution: {
        action: "request-review",
        method: "POST",
        path: `${routeBase}/request-review`,
      },
    });
  }

  if (
    context.org.settings?.requireRebaseBeforePublish &&
    isRevisionDiverged(
      adapter,
      revision.target.snapshot as Record<string, unknown>,
      entity,
    )
  ) {
    gates.push({
      type: "stale-base",
      severity: "blocker",
      messages: ["This revision was created against an older version."],
      override: "ignoreWarnings",
      requiresPermission: "bypassApprovalChecks",
      resolution: {
        action: "rebase",
        method: "POST",
        path: `${routeBase}/rebase`,
      },
    });
  }

  return gates;
}

/**
 * The approval gate for the direct archive/unarchive endpoints.
 * `approvalRequired` is computed by the caller (each handler runs the
 * adapter's change-aware check against a synthetic archive revision), and the
 * create-draft resolution path is passed in because it is not uniform across
 * entities.
 */
export function collectArchiveApprovalGate({
  approvalRequired,
  archived,
  noun,
  createDraftPath,
}: {
  approvalRequired: boolean;
  archived: boolean;
  noun: string;
  createDraftPath: string;
}): PublishGate[] {
  if (!approvalRequired) return [];
  return [
    {
      type: "approval-required",
      severity: "blocker",
      messages: [
        `This organization requires approval to ${
          archived ? "archive" : "unarchive"
        } this ${noun}.`,
      ],
      override: null,
      requiresPermission: "bypassApprovalChecks",
      resolution: {
        action: "create-draft",
        method: "POST",
        path: createDraftPath,
      },
    },
  ];
}
