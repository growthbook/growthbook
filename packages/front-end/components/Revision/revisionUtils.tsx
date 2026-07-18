import React from "react";
import { Flex } from "@radix-ui/themes";
import { Revision, RevisionStatus } from "shared/enterprise";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import { ExperimentDot } from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import {
  revisionStatusColor,
  revisionStatusLabel,
  revisionStatusBadgeVariant,
} from "@/components/Reviews/RevisionStatusBadge";

export type RevisionBadgeStatus = RevisionStatus | "live";

// Render a revision status badge. Delegates color/label/variant to the feature
// status helpers (`components/Reviews/RevisionStatusBadge`) so features, saved
// groups, and constants all share one source of truth for draft-state styling.
export function getStatusBadge(
  status: RevisionBadgeStatus,
  requiresApproval: boolean = true,
) {
  // If approvals are not required, show pending-review as Draft.
  const effective: RevisionBadgeStatus =
    status === "pending-review" && !requiresApproval ? "draft" : status;
  // The feature helpers key off the feature revision status, which uses
  // "published" where the generic revision model uses "merged" (both = Locked).
  const featureStatus = (
    effective === "merged" ? "published" : effective
  ) as Parameters<typeof revisionStatusColor>[0];
  return (
    <Badge
      label={revisionStatusLabel(effective)}
      color={revisionStatusColor(featureStatus)}
      variant={revisionStatusBadgeVariant(featureStatus)}
      radius="full"
    />
  );
}

// Colored-dot + label rendering used by the approvals inbox + saved-group
// reviews tab. Mirrors the home-page "Feature flags requiring attention" style
// so status rendering stays consistent across dashboards.
export function renderRevisionStatusCell(status: RevisionStatus) {
  switch (status) {
    case "approved":
      return (
        <Flex gap="1" align="center">
          <ExperimentDot color="green" />
          Approved
        </Flex>
      );
    case "pending-review":
      return (
        <Flex gap="1" align="center">
          <ExperimentDot color="amber" />
          Pending Review
        </Flex>
      );
    case "draft":
      return <span className="mr-3">Draft</span>;
    case "changes-requested":
      return (
        <Flex gap="1" align="center">
          <ExperimentDot color="red" />
          Changes Requested
        </Flex>
      );
    case "merged":
      return <span className="mr-3">Locked</span>;
    case "discarded":
      return <span className="mr-3">Discarded</span>;
    default:
      return null;
  }
}

// Builds the saved-group revision deep-link using `?v=<n>`. Falls back to the
// base URL only when the revision has no version populated.
export function buildSavedGroupRevisionUrl(
  savedGroupId: string,
  revision?: Pick<Revision, "version"> | null,
): string {
  const base = `/saved-groups/${savedGroupId}`;
  if (revision && revision.version !== undefined)
    return `${base}?v=${revision.version}`;
  return base;
}

// Builds the constant revision deep-link using `?v=<n>` (mirrors saved groups).
// The detail page is addressed by the constant's `key`, not its internal id.
export function buildConstantRevisionUrl(
  constantKey: string,
  revision?: Pick<Revision, "version"> | null,
): string {
  const base = `/constants/${constantKey}`;
  if (revision && revision.version !== undefined)
    return `${base}?v=${revision.version}`;
  return base;
}

// Config revision deep-link. Configs are `config`-type constants but live on the
// dedicated `/configs` route.
export function buildConfigRevisionUrl(
  configKey: string,
  revision?: Pick<Revision, "version"> | null,
): string {
  const base = `/configs/${configKey}`;
  if (revision && revision.version !== undefined)
    return `${base}?v=${revision.version}`;
  return base;
}

export function RevisionStatusDot({
  hasOpenRevisions,
}: {
  hasOpenRevisions?: boolean;
}) {
  if (!hasOpenRevisions) return null;
  return (
    <Tooltip content={revisionStatusLabel("pending-review")}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: `var(--${revisionStatusColor("pending-review")}-9)`,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
    </Tooltip>
  );
}
