export type StatusBadgeHealth = "not-enough-traffic" | "unhealthy" | "healthy";

interface Props {
  status: StatusBadgeHealth;
}

export const StatusBadge = ({ status }: Props) => {
  if (status === "healthy") return null;

  return (
    <span
      className={"badge badge-pill border ml-2 mr-2 " + getBadgeColor(status)}
    >
      {getStatusText(status)}
    </span>
  );
};

const getBadgeColor = (status: "unhealthy" | "not-enough-traffic"): string => {
  switch (status) {
    case "unhealthy":
      return "badge-warning";

    case "not-enough-traffic":
      return "badge-light";

    default: {
      const _exhaustiveCheck: never = status;
      throw new Error(`Unknown status: ${_exhaustiveCheck}`);
    }
  }
};

const getStatusText = (status: "unhealthy" | "not-enough-traffic"): string => {
  switch (status) {
    case "unhealthy":
      return "Issues detected";

    case "not-enough-traffic":
      return "Not enough traffic";

    default: {
      const _exhaustiveCheck: never = status;
      throw new Error(`Unknown status: ${_exhaustiveCheck}`);
    }
  }
};
