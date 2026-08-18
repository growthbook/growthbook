import { bypassApprovalPermission } from "shared/permissions";
import type { RevisionModel } from "shared/permissions";
import type { Revision, RevisionTargetType } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import type { EntityRevisionAdapter } from "back-end/src/revisions/EntityRevisionAdapter";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { makeBlockingGate } from "back-end/src/revisions/publishGates";
import { isRevisionDiverged } from "back-end/src/revisions/util";
import {
  revisionApprovalsCoverChange,
  revisionRequiredApproverTeams,
} from "back-end/src/revisions/revisionActions";

// The approval-required and stale-base publish gates for any entity on the
// generic revision system — the single implementation behind both the
// single-entity REST publish handlers and the bulk publisher. Approval
// scoping stays per-adapter (`isApprovalRequiredForRevision`); this collector
// must never flatten it into an org-level check. Features are deliberately
// NOT served here — their gates live in services/featurePublishGates.ts.
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
  const bypassPermission = bypassApprovalPermission(targetType);

  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(context, revision)
    : adapter.isApprovalRequired(context);
  // Coverage, not just status: an approval given while the change was narrower
  // does not sanction what it would land now. Same predicate the sequential
  // publish path uses, so the gate model and the backstop cannot disagree.
  const coverage = revisionApprovalsCoverChange(context, revision);
  const approvedAndCovered =
    revision.status === "approved" && coverage.hasCoveringApproval;
  if (approvalRequired && !approvedAndCovered) {
    gates.push(
      makeBlockingGate({
        type: "approval-required",
        messages: [
          revision.status === "approved" && coverage.uncoveredApprovers.length
            ? "This revision now changes environments its approvers cannot approve. Needs approval from someone with review rights across everything it changes."
            : `Requires approval before publishing (status: "${revision.status}").`,
        ],
        requiresPermission: bypassPermission,
        resolution: {
          action: "request-review",
          method: "POST",
          path: `${routeBase}/request-review`,
        },
      }),
    );
  }

  // Separate from "needs an approval": the draft can be properly approved and
  // still be missing the team its review rule names.
  const requiredTeams = revisionRequiredApproverTeams(
    context,
    revision,
    coverage,
  );
  if (approvalRequired && !requiredTeams.satisfied) {
    gates.push(
      makeBlockingGate({
        type: "required-approvers-missing",
        messages: requiredTeams.unmet.map(
          (teams) =>
            `Requires approval from ${teams.map((t) => t.name).join(" or ")}.`,
        ),
        requiresPermission: bypassPermission,
        resolution: {
          action: "request-review",
          method: "POST",
          path: `${routeBase}/request-review`,
        },
      }),
    );
  }

  if (
    context.org.settings?.requireRebaseBeforePublish &&
    isRevisionDiverged(
      adapter,
      revision.target.snapshot as Record<string, unknown>,
      entity,
    )
  ) {
    gates.push(
      makeBlockingGate({
        type: "stale-base",
        messages: ["This revision was created against an older version."],
        override: "ignoreWarnings",
        requiresPermission: bypassPermission,
        resolution: {
          action: "rebase",
          method: "POST",
          path: `${routeBase}/rebase`,
        },
      }),
    );
  }

  return gates;
}

// The approval gate for the direct archive/unarchive endpoints.
// `approvalRequired` is computed by the caller (each handler runs the
// adapter's change-aware check against a synthetic archive revision), and the
// create-draft resolution path is passed in because it is not uniform across
// entities.
export function collectArchiveApprovalGate({
  approvalRequired,
  archived,
  noun,
  createDraftPath,
  model,
}: {
  approvalRequired: boolean;
  archived: boolean;
  noun: string;
  createDraftPath: string;
  /** The entity being archived, so the gate names its family's bypass atom. */
  model: RevisionModel;
}): PublishGate[] {
  if (!approvalRequired) return [];
  return [
    makeBlockingGate({
      type: "approval-required",
      messages: [
        `This organization requires approval to ${
          archived ? "archive" : "unarchive"
        } this ${noun}.`,
      ],
      requiresPermission: bypassApprovalPermission(model),
      resolution: {
        action: "create-draft",
        method: "POST",
        path: createDraftPath,
      },
    }),
  ];
}
