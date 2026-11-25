import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";

export type StatusBadgeHealth = "not-enough-traffic" | "unhealthy" | "healthy";

interface Props {
  status: StatusBadgeHealth;
}

export const StatusBadge = ({ status }: Props) => {
  const { i18n } = useLingui();
  if (status === "healthy") return null;

  return (
    <span
      className={"badge badge-pill border ml-2 mr-2 " + getBadgeColor(status)}
    >
      {i18n._(getStatusText(status))}
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

const getStatusText = (
  status: "unhealthy" | "not-enough-traffic",
): MessageDescriptor => {
  switch (status) {
    case "unhealthy":
      return msg`Issues detected`;

    case "not-enough-traffic":
      return msg`Not enough traffic`;

    default: {
      const _exhaustiveCheck: never = status;
      throw new Error(`Unknown status: ${_exhaustiveCheck}`);
    }
  }
};
