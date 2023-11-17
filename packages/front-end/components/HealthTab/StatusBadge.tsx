import Tooltip from "../Tooltip/Tooltip";

export const BadgeColors = {
  healthy: "badge-green",
  unhealthy: "badge-red",
  "not enough data": "badge-gray",
};
export type HealthStatus = keyof typeof BadgeColors;

interface Props {
  status: HealthStatus;
  hasTooltip?: boolean;
  tooltipBody?: string | JSX.Element;
}

export const StatusBadge = ({
  status,
  hasTooltip = true,
  tooltipBody = "",
}: Props) => {
  if (hasTooltip) {
    return (
      <Tooltip
        body={tooltipBody}
        className={"badge border ml-2 mr-2 " + BadgeColors[status]}
        tipPosition="top"
      >
        {status}
      </Tooltip>
    );
  }

  return (
    <span className={"badge border ml-2 mr-2 " + BadgeColors[status]}>
      {status}
    </span>
  );
};
