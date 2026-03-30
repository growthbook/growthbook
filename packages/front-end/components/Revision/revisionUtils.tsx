import React from "react";
import { RevisionStatus } from "shared/enterprise";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";

export const STATUS_CONFIG: Record<
  RevisionStatus,
  { color: "gray" | "blue" | "indigo" | "amber" | "red"; label: string }
> = {
  draft: { color: "indigo", label: "Draft" },
  "pending-review": { color: "blue", label: "Pending review" },
  approved: { color: "gray", label: "Approved" },
  "changes-requested": { color: "amber", label: "Changes requested" },
  merged: { color: "gray", label: "Locked" },
  discarded: { color: "gray", label: "Discarded" },
};

export function getStatusBadge(
  status: RevisionStatus,
  requiresApproval: boolean = true,
) {
  // If approvals are not required, show pending-review as Draft
  if (status === "pending-review" && !requiresApproval) {
    const config = STATUS_CONFIG["draft"];
    return <Badge label={config.label} color={config.color} variant="soft" />;
  }
  const config = STATUS_CONFIG[status];
  return <Badge label={config.label} color={config.color} variant="soft" />;
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
