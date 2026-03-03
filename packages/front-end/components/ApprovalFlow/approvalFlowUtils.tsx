import React from "react";
import { ApprovalFlowStatus } from "shared/enterprise";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";

export const STATUS_CONFIG: Record<
  ApprovalFlowStatus,
  { color: "gray" | "yellow" | "green" | "orange" | "purple"; label: string }
> = {
  draft: { color: "gray", label: "Draft" },
  "pending-review": { color: "yellow", label: "Pending review" },
  approved: { color: "green", label: "Approved" },
  "changes-requested": { color: "orange", label: "Changes requested" },
  merged: { color: "purple", label: "Published" },
  closed: { color: "gray", label: "Closed" },
};

export function getStatusBadge(status: ApprovalFlowStatus) {
  const config = STATUS_CONFIG[status];
  return <Badge label={config.label} color={config.color} variant="soft" />;
}

export function ApprovalFlowStatusDot({
  hasOpenFlows,
}: {
  hasOpenFlows?: boolean;
}) {
  if (!hasOpenFlows) return null;
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
