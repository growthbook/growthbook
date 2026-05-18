import React from "react";
import { Flex } from "@radix-ui/themes";
import { Revision, RevisionStatus } from "shared/enterprise";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import { ExperimentDot } from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";

// Status → badge color & label. Colors mirror the feature revision badge
// (`components/Features/RevisionStatusBadge.tsx`) so revisions render
// consistently across features and saved groups.
export type RevisionBadgeStatus = RevisionStatus | "live";

export const STATUS_CONFIG: Record<
  RevisionBadgeStatus,
  {
    color: "teal" | "plum" | "orange" | "grass" | "amber" | "red" | "gray";
    label: string;
  }
> = {
  live: { color: "teal", label: "Live" },
  draft: { color: "plum", label: "Draft" },
  "pending-review": { color: "orange", label: "Pending review" },
  approved: { color: "grass", label: "Approved" },
  "changes-requested": { color: "amber", label: "Changes requested" },
  merged: { color: "gray", label: "Locked" },
  discarded: { color: "red", label: "Discarded" },
};

export function getStatusBadge(
  status: RevisionBadgeStatus,
  requiresApproval: boolean = true,
) {
  // If approvals are not required, show pending-review as Draft
  const effective: RevisionBadgeStatus =
    status === "pending-review" && !requiresApproval ? "draft" : status;
  const config = STATUS_CONFIG[effective];
  if (!config) {
    return <Badge label={String(status)} color="gray" radius="full" />;
  }
  return <Badge label={config.label} color={config.color} radius="full" />;
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
  if (revision?.version != null) return `${base}?v=${revision.version}`;
  return base;
}

export function RevisionStatusDot({
  hasOpenRevisions,
}: {
  hasOpenRevisions?: boolean;
}) {
  if (!hasOpenRevisions) return null;
  const { color, label } = STATUS_CONFIG["pending-review"];
  return (
    <Tooltip content={label}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: `var(--${color}-9)`,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
    </Tooltip>
  );
}
