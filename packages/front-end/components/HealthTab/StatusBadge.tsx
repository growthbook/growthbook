export const BadgeColors = {
  "Issues detected": "badge-warning",
  "Not enough traffic": "badge-light",
};
export type HealthStatus = keyof typeof BadgeColors | "healthy";

interface Props {
  status: HealthStatus;
}

export const StatusBadge = ({ status }: Props) => {
  return (
    <span
      className={"badge badge-pill border ml-2 mr-2 " + BadgeColors[status]}
    >
      {status}
    </span>
  );
};
