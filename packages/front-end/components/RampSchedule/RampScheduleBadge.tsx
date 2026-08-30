import { ReactNode } from "react";
import {
  isReadyForApproval,
  isAwaitingStartApproval,
  RampScheduleInterface,
} from "shared/validators";
import { abbreviateAgo, dateNoYear, datetime } from "shared/dates";
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";
import {
  getRampBadgeColor,
  getRampStatusLabel,
} from "@/components/RampSchedule/RampTimeline";
import { formatRollbackReason } from "@/components/RampSchedule/rollbackReason";
export default function RampScheduleBadge({
  rs,
  featureRuleContext = false,
  pendingDetach = false,
  simpleSchedule = false,
}: {
  rs: RampScheduleInterface;
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
  // Surface "Starts in …" only while the schedule is genuinely waiting to
  // start (pending/ready). Once it's running/paused/completed the original
  // startDate is stale UI noise.
  const preStart = rs.status === "pending" || rs.status === "ready";

  // `key` matters when rows are rendered as an array (tooltipRows /
  // timingTooltipRows); the label is unique within each list.
  const dateRow = (label: string, d: Date) => (
    <div key={label}>
      <span className="text-muted">{label}: </span>
      {datetime(d)}
    </div>
  );

  if (simpleSchedule) {
    const statusLabels: Partial<Record<string, string>> = {
      pending: "Schedule pending publish",
      ready: "Schedule scheduled",
      running: "Schedule active",
      paused: "Schedule paused",
      completed: "Schedule completed",
      "rolled-back": "Rolled back",
    };
    const displayLabel = isAwaitingStartApproval(rs)
      ? "Awaiting approval"
      : isReadyForApproval(rs)
        ? "Schedule needs approval"
        : (statusLabels[rs.status] ??
          `Schedule ${getRampStatusLabel(rs).toLowerCase()}`);

    const endAt = rs.cutoffDate ? new Date(rs.cutoffDate) : null;
    const futureEnd = endAt && endAt > now;

    let timingLabel: string | null = null;
    if (preStart && futureStart) {
      timingLabel = `Starts ${abbreviateAgo(startAt)}`;
    } else if (rs.status === "running" && futureEnd) {
      timingLabel = `Disables ${dateNoYear(endAt)}`;
    }
    const tooltipRows: ReactNode[] = [];
    if (startAt) tooltipRows.push(dateRow("Starts", startAt));
    if (endAt) tooltipRows.push(dateRow("Disables", endAt));

    const badge = (
      <Badge
        label={displayLabel + (timingLabel ? ` · ${timingLabel}` : "")}
        color={getRampBadgeColor(rs)}
        radius="full"
      />
    );

    if (tooltipRows.length === 0) return badge;

    return (
      <Tooltip
        body={<>{tooltipRows}</>}
        style={{ display: "inline-flex", alignItems: "center" }}
      >
        {badge}
      </Tooltip>
    );
  }

  const completedAt =
    rs.status === "completed" && rs.dateUpdated
      ? new Date(rs.dateUpdated)
      : null;
  const pausedAt =
    rs.status === "paused" && rs.pausedAt ? new Date(rs.pausedAt) : null;

  const endAt = rs.cutoffDate ? new Date(rs.cutoffDate) : null;
  const futureEnd = endAt && endAt > now;
  const allStepsDone =
    rs.status === "running" &&
    rs.steps.length > 0 &&
    rs.currentStepIndex >= rs.steps.length;

  let timingLabel: string | null = null;
  const timingTooltipRows: ReactNode[] = [];
  if (preStart && futureStart) {
    timingLabel = `Starts ${abbreviateAgo(startAt)}`;
    timingTooltipRows.push(dateRow("Starts", startAt));
  } else if (allStepsDone && futureEnd) {
    timingLabel = `Disables ${dateNoYear(endAt)}`;
  }
  if (rs.cutoffDate) {
    timingTooltipRows.push(dateRow("Disables", new Date(rs.cutoffDate)));
  }
  const timingTooltip =
    timingTooltipRows.length > 0 ? <>{timingTooltipRows}</> : null;

  const baseLabel = getRampStatusLabel(rs);

  // simpleSchedule short-circuits above, so always treat as ramp here.
  const featureContextLabels: Partial<Record<string, string>> = {
    pending: "Ramp pending publish",
    ready: "Ramp scheduled",
    running: "Ramp active",
    paused: "Ramp paused",
    completed: "Ramp completed",
    "rolled-back": "Rolled back",
  };
  let featureContextLabel = isAwaitingStartApproval(rs)
    ? "Awaiting approval"
    : isReadyForApproval(rs)
      ? "Ramp needs approval"
      : (featureContextLabels[rs.status] ?? `Ramp ${baseLabel.toLowerCase()}`);
  if (allStepsDone && futureEnd) {
    featureContextLabel = "Ramp completed";
  }
  const displayLabel = featureRuleContext ? featureContextLabel : baseLabel;

  const badge = (
    <Badge
      label={displayLabel + (timingLabel ? ` · ${timingLabel}` : "")}
      color={getRampBadgeColor(rs)}
      radius="full"
    />
  );

  const contextLine = featureRuleContext && rs.status !== "completed" && (
    <p>
      This feature rule is controlled by a Ramp Schedule (
      <strong>{rs.name}</strong>)
    </p>
  );
  const rolledBackAt =
    rs.status === "rolled-back" && rs.lastRollbackAt
      ? new Date(rs.lastRollbackAt)
      : null;
  const statusLine =
    rs.status === "completed" ? (
      <p>
        {completedAt
          ? dateRow("Completed", completedAt)
          : "Schedule completed."}
        {featureRuleContext && (
          <>The ramp may be safely removed by editing this rule.</>
        )}
      </p>
    ) : rs.status === "rolled-back" ? (
      <div>
        {rolledBackAt && dateRow("Rolled back", rolledBackAt)}
        {formatRollbackReason(rs.lastRollbackReason) && (
          <div>
            <span className="text-muted">Reason: </span>
            {formatRollbackReason(rs.lastRollbackReason)}
          </div>
        )}
      </div>
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
