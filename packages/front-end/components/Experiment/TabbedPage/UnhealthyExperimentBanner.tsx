import { Fragment } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiCaretRight } from "react-icons/pi";
import { DEFAULT_SRM_THRESHOLD } from "shared/constants";
import {
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
} from "shared/types/experiment";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useUser } from "@/services/UserContext";
import { getHealthIssues } from "./ExperimentHealthBadges";

// Stands in for the results' own health warnings while it shows.
export function showsUnhealthyBanner(
  experiment: ExperimentInterfaceStringDates,
  status: ExperimentResultStatusData | undefined,
) {
  return (
    experiment.status === "running" &&
    experiment.type !== "holdout" &&
    status?.status === "unhealthy"
  );
}

type Props = {
  status: ExperimentResultStatusData;
  viewHealth: (() => void) | null;
} & MarginProps;

export default function UnhealthyExperimentBanner({
  status,
  viewHealth,
  ...margin
}: Props) {
  const { settings } = useUser();
  if (status.status !== "unhealthy") return null;
  const issues = getHealthIssues(
    status,
    settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD,
  );
  const severe = issues.some((issue) => issue.color === "red");

  return (
    <Callout
      status="warning"
      contentAlign="center"
      action={
        viewHealth ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<PiCaretRight />}
            iconPosition="right"
            onClick={viewHealth}
          >
            View health
          </Button>
        ) : null
      }
      {...margin}
    >
      <Text weight="semibold">Unhealthy:</Text>{" "}
      {issues.map(({ label, detail }, i) => (
        <Fragment key={label}>
          {i ? ", " : null}
          <Tooltip content={detail}>
            <span>{label}</span>
          </Tooltip>
        </Fragment>
      ))}
      .{" "}
      {severe
        ? "Results are likely untrustworthy."
        : "It's unlikely to detect the target effect in time."}
    </Callout>
  );
}
