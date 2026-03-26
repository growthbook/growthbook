import { ReactNode } from "react";
import { RampScheduleInterface } from "shared/validators";
import { abbreviateAgo, datetime } from "shared/dates";
import { PiHourglassMediumFill } from "react-icons/pi";
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";
import {
  getRampBadgeColor,
  getRampStatusLabel,
} from "@/components/RampSchedule/RampTimeline";
export default function RampScheduleBadge({
  rs,
  withIcon = false,
  featureRuleContext = false,
}: {
  rs: RampScheduleInterface;
  withIcon?: boolean;
  featureRuleContext?: boolean;
}) {
  const now = new Date();
  const startTrigger = rs.startCondition?.trigger;
  const endTrigger = rs.endCondition?.trigger;
  const startAt =
    startTrigger?.type === "scheduled" ? new Date(startTrigger.at) : null;
  const endAt =
    endTrigger?.type === "scheduled" ? new Date(endTrigger.at) : null;
  const futureStart = startAt && startAt > now;
  const futureEnd = endAt && endAt > now;

  const dateRow = (label: string, d: Date) => (
    <div>
      <span className="text-muted">{label}: </span>
      {datetime(d)}
    </div>
  );

  let timingLabel: string | null = null;
  let timingTooltip: ReactNode = null;
  if (futureStart && futureEnd) {
    timingLabel = `Starts ${abbreviateAgo(startAt)} · ends ${abbreviateAgo(endAt)}`;
    timingTooltip = (
      <>
        {dateRow("Starts", startAt)}
        {dateRow("Ends", endAt)}
      </>
    );
  } else if (futureStart) {
    timingLabel = `Starts ${abbreviateAgo(startAt)}`;
    timingTooltip = dateRow("Starts", startAt);
  } else if (futureEnd) {
    timingLabel = `Ends ${abbreviateAgo(endAt)}`;
    timingTooltip = dateRow("Ends", endAt);
  }

  const badge = (
    <Badge
      label={
        <>
          {withIcon ? <PiHourglassMediumFill size={16} /> : null}
          {getRampStatusLabel(rs) + (timingLabel ? ` · ${timingLabel}` : "")}
        </>
      }
      color={getRampBadgeColor(rs.status)}
      radius="full"
    />
  );

  const tooltipContent = (
    <>
      {featureRuleContext && (
        <p>
          This feature rule is controlled by a Ramp Schedule (
          <strong>{rs.name}</strong>)
        </p>
      )}
      {timingTooltip && <div>{timingTooltip}</div>}
    </>
  );

  return <Tooltip body={tooltipContent}>{badge}</Tooltip>;
}
