import { ReactNode } from "react";
import { RampScheduleInterface } from "shared/validators";
import { abbreviateAgo, datetime } from "shared/dates";
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";
import {
  getRampBadgeColor,
  getRampStatusLabel,
} from "@/components/RampSchedule/RampTimeline";
export default function RampScheduleBadge({
  rs,
  withIcon: _withIcon = false,
  featureRuleContext = false,
  pendingDetach = false,
  simpleSchedule = false,
}: {
  rs: RampScheduleInterface;
  withIcon?: boolean;
  featureRuleContext?: boolean;
  /** When true, the draft contains a pending removal for this schedule. */
  pendingDetach?: boolean;
  /** When true, show only timing information without status labels or tooltip. */
  simpleSchedule?: boolean;
}) {
  // Pending detach overrides everything — show a dedicated red badge with tooltip.
  if (pendingDetach) {
    return (
      <Tooltip
        body={
          <p>
            This rule&apos;s ramp schedule (<strong>{rs.name}</strong>) is
            queued to be removed. Publish the draft to complete the removal.
          </p>
        }
        style={{ display: "inline-flex", alignItems: "center" }}
      >
        <Badge
          label="ramp schedule will be removed"
          color="red"
          radius="full"
        />
      </Tooltip>
    );
  }

  const now = new Date();
  const startAt = rs.startDate ? new Date(rs.startDate) : null;
  const futureStart = startAt && startAt > now;

  // Simple schedule: show only timing, no status prefix, no tooltip.
  if (simpleSchedule) {
    let label: string;
    if (rs.status === "running") {
      label = "Running";
    } else if (futureStart) {
      label = `Starts ${abbreviateAgo(startAt)}`;
    } else {
      label = "Active";
    }
    return (
      <Badge label={label} color={getRampBadgeColor(rs.status)} radius="full" />
    );
  }

  const dateRow = (label: string, d: Date) => (
    <div>
      <span className="text-muted">{label}: </span>
      {datetime(d)}
    </div>
  );

  const completedAt =
    rs.status === "completed" && rs.dateUpdated
      ? new Date(rs.dateUpdated)
      : null;
  const pausedAt =
    rs.status === "paused" && rs.pausedAt ? new Date(rs.pausedAt) : null;

  let timingLabel: string | null = null;
  let timingTooltip: ReactNode = null;
  if (futureStart) {
    timingLabel = `Starts ${abbreviateAgo(startAt)}`;
    timingTooltip = dateRow("Starts", startAt);
  }

  const baseLabel = getRampStatusLabel(rs);
  const displayLabel = featureRuleContext
    ? `schedule: ${baseLabel.replace(/^schedule start is /, "").replace(/^schedule: /, "")}`
    : baseLabel;

  const badge = (
    <Badge
      label={
        rs.status === "running"
          ? "Running"
          : displayLabel + (timingLabel ? ` · ${timingLabel}` : "")
      }
      color={getRampBadgeColor(rs.status)}
      radius="full"
    />
  );

  const contextLine = featureRuleContext && rs.status !== "completed" && (
    <p>
      This feature rule is controlled by a Ramp Schedule (
      <strong>{rs.name}</strong>)
    </p>
  );
  const statusLine =
    rs.status === "completed" ? (
      <p>
        {completedAt
          ? dateRow("Completed", completedAt)
          : "Schedule completed."}
        {featureRuleContext && (
          <> The ramp schedule may be safely removed from this rule.</>
        )}
      </p>
    ) : pausedAt ? (
      dateRow("Paused", pausedAt)
    ) : null;

  const hasTooltip = !!(contextLine || statusLine || timingTooltip);
  if (!hasTooltip) return badge;

  return (
    <Tooltip
      body={
        <>
          {contextLine}
          {statusLine}
          {timingTooltip && <div>{timingTooltip}</div>}
        </>
      }
      style={{ display: "inline-flex", alignItems: "center" }}
    >
      {badge}
    </Tooltip>
  );
}
