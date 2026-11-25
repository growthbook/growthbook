import { ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  getRampRetry,
  isReadyForApproval,
  isAwaitingStartApproval,
  RampScheduleInterface,
} from "shared/validators";
import { abbreviateAgo, dateNoYear, datetime } from "shared/dates";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import {
  rampCompletedAt,
  rampScheduleDates,
  ScheduleDate,
  scheduleVerb,
} from "@/services/scheduleRules";
import {
  getRampBadgeColor,
  getRampStatusMessage,
} from "@/components/RampSchedule/RampTimeline";
import { formatRollbackReason } from "@/components/RampSchedule/rollbackReason";
// Dimmed from the tooltip's own text color, which reads on its dark fill.
const TOOLTIP_LABEL_STYLE = { opacity: 0.7 };

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
  const { t, i18n } = useLingui();
  const rsName = rs.name;
  // Pending detach overrides everything — show a dedicated red badge with tooltip.
  if (pendingDetach) {
    return (
      <Tooltip
        content={
          <div>
            <Trans>
              This rule&apos;s ramp schedule (<strong>{rsName}</strong>) is
              queued to be removed. Publish the draft to complete the removal.
            </Trans>
          </div>
        }
      >
        <Badge
          label={t`ramp schedule will be removed`}
          color="red"
          radius="full"
        />
      </Tooltip>
    );
  }

  const now = new Date();
  const retry = getRampRetry(rs);
  const startAt = rs.startDate ? new Date(rs.startDate) : null;
  const futureStart = startAt && startAt > now;
  // Surface "Starts in …" only while the schedule is genuinely waiting to
  // start (pending/ready). Once it's running/paused/completed the original
  // startDate is stale UI noise.
  const preStart = rs.status === "pending" || rs.status === "ready";
  const statusMessage = getRampStatusMessage(rs);
  const baseLabel = statusMessage ? i18n._(statusMessage) : rs.status;
  // Used by the fallback labels below, which only see an unknown status.
  const lowerStatus = baseLabel.toLocaleLowerCase(i18n.locale);

  // `key` matters when rows are rendered as an array (tooltipRows /
  // timingTooltipRows); the label is unique within each list.
  const dateRow = (label: string, d: Date) => (
    <div key={label}>
      <span style={TOOLTIP_LABEL_STYLE}>{label}: </span>
      {datetime(d)}
    </div>
  );

  if (simpleSchedule) {
    const statusLabels: Partial<Record<string, string>> = {
      pending: t`Schedule pending publish`,
      ready: t`Schedule scheduled`,
      running: t`Schedule active`,
      paused: t`Schedule paused`,
      completed: t`Schedule completed`,
      "rolled-back": t`Rolled back`,
    };
    const displayLabel = retry
      ? t`Schedule retrying`
      : isAwaitingStartApproval(rs)
        ? t`Awaiting approval`
        : isReadyForApproval(rs)
          ? t`Schedule needs approval`
          : (statusLabels[rs.status] ?? t`Schedule ${lowerStatus}`);

    const endAt = rs.cutoffDate ? new Date(rs.cutoffDate) : null;
    const futureEnd = endAt && endAt > now;

    let timingLabel: string | null = null;
    if (preStart && futureStart) {
      const startsIn = abbreviateAgo(startAt);
      timingLabel = t`Starts ${startsIn}`;
    } else if (rs.status === "running" && futureEnd) {
      const endDate = dateNoYear(endAt);
      timingLabel = t`Disables ${endDate}`;
    }
    const { start, end } = rampScheduleDates(rs, i18n, now);
    const tooltipRows = [
      ...(retry ? [dateRow(t`Next attempt`, new Date(retry.retryAt))] : []),
      ...[start, end]
        .filter((d): d is ScheduleDate => d !== null)
        .map(({ label, date }) => dateRow(label, date)),
    ];

    const badge = (
      <Badge
        label={displayLabel + (timingLabel ? ` · ${timingLabel}` : "")}
        color={getRampBadgeColor(rs)}
        radius="full"
      />
    );

    if (tooltipRows.length === 0) return badge;

    return <Tooltip content={<>{tooltipRows}</>}>{badge}</Tooltip>;
  }

  const completedAt = rampCompletedAt(rs);
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
    const startsIn = abbreviateAgo(startAt);
    timingLabel = t`Starts ${startsIn}`;
    timingTooltipRows.push(
      dateRow(scheduleVerb(startAt, t`Starts`, t`Started`, now), startAt),
    );
  } else if (allStepsDone && futureEnd) {
    const endDate = dateNoYear(endAt);
    timingLabel = t`Disables ${endDate}`;
  }
  if (rs.cutoffDate) {
    const cutoff = new Date(rs.cutoffDate);
    timingTooltipRows.push(
      dateRow(scheduleVerb(cutoff, t`Disables`, t`Disabled`, now), cutoff),
    );
  }
  const timingTooltip =
    timingTooltipRows.length > 0 ? <>{timingTooltipRows}</> : null;

  // simpleSchedule short-circuits above, so always treat as ramp here.
  const featureContextLabels: Partial<Record<string, string>> = {
    pending: t`Ramp pending publish`,
    ready: t`Ramp scheduled`,
    running: t`Ramp active`,
    paused: t`Ramp paused`,
    completed: t`Ramp completed`,
    "rolled-back": t`Rolled back`,
  };
  let featureContextLabel = retry
    ? t`Ramp retrying`
    : isAwaitingStartApproval(rs)
      ? t`Awaiting approval`
      : isReadyForApproval(rs)
        ? t`Ramp needs approval`
        : (featureContextLabels[rs.status] ?? t`Ramp ${lowerStatus}`);
  if (allStepsDone && futureEnd) {
    featureContextLabel = t`Ramp completed`;
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
    <div>
      <Trans>
        This feature rule is controlled by a Ramp Schedule (
        <strong>{rsName}</strong>)
      </Trans>
    </div>
  );
  const rolledBackAt =
    rs.status === "rolled-back" && rs.lastRollbackAt
      ? new Date(rs.lastRollbackAt)
      : null;
  const retryLine = retry && (
    <div>
      <div>
        <span style={TOOLTIP_LABEL_STYLE}>{t`Failed attempts:`} </span>
        {retry.attempts}
      </div>
      {dateRow(t`Next attempt`, new Date(retry.retryAt))}
    </div>
  );
  const statusLine =
    rs.status === "completed" ? (
      <div>
        {completedAt ? (
          dateRow(t`Completed`, completedAt)
        ) : (
          <div>
            <Trans>Schedule completed.</Trans>
          </div>
        )}
        {featureRuleContext && (
          <div>
            <Trans>The ramp may be safely removed by editing this rule.</Trans>
          </div>
        )}
      </div>
    ) : rs.status === "rolled-back" ? (
      <div>
        {rolledBackAt && dateRow(t`Rolled back`, rolledBackAt)}
        {formatRollbackReason(rs.lastRollbackReason, i18n) && (
          <div>
            <span style={TOOLTIP_LABEL_STYLE}>{t`Reason:`} </span>
            {formatRollbackReason(rs.lastRollbackReason, i18n)}
          </div>
        )}
      </div>
    ) : pausedAt ? (
      dateRow(t`Paused`, pausedAt)
    ) : null;

  const hasTooltip = !!(
    contextLine ||
    retryLine ||
    statusLine ||
    timingTooltip
  );
  if (!hasTooltip) return badge;

  return (
    <Tooltip
      content={
        <>
          {contextLine}
          {retryLine}
          {statusLine}
          {timingTooltip && <div>{timingTooltip}</div>}
        </>
      }
    >
      {badge}
    </Tooltip>
  );
}
