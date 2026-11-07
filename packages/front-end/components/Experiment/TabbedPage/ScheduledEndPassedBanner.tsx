import { Box } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
} from "shared/types/experiment";
import { date } from "shared/dates";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiClockFill, PiWarningCircleBold } from "react-icons/pi";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { Reason } from "./ExperimentDecisionExplanation";
import ExperimentBanner from "./ExperimentBanner";

type Props = {
  experiment: ExperimentInterfaceStringDates;
  runningExperimentStatus?: ExperimentResultStatusData;
  editSchedule?: () => void;
} & MarginProps;

type DecisiveStatus = "ship-now" | "rollback-now" | "ready-for-review";

type NonDecisiveStatusData = Exclude<
  ExperimentResultStatusData,
  { status: DecisiveStatus }
>;

function getReasonText(statusData: NonDecisiveStatusData): string {
  switch (statusData.status) {
    case "unhealthy":
      return `Results are unhealthy${
        statusData.tooltip ? ` (${statusData.tooltip})` : ""
      }.`;
    case "no-data":
      return statusData.tooltip
        ? `${statusData.tooltip}.`
        : "There is no data yet.";
    case "data-incomplete":
      return "One or more goal or guardrail metrics could not be computed, so no decision recommendation is available.";
    case "scheduled-end-review":
      return statusData.tooltip ?? "No decision recommendation is available.";
    case "days-left":
      return statusData.tooltip
        ? statusData.tooltip
        : `More data is needed — about ${statusData.daysLeft} more ${
            statusData.daysLeft === 1 ? "day" : "days"
          } to reach the targeted statistical power.`;
    case "before-min-duration":
      return "The minimum experiment duration has not been reached yet.";
    default:
      return "No decision recommendation is available.";
  }
}

export default function ScheduledEndPassedBanner({
  experiment,
  runningExperimentStatus,
  editSchedule,
  ...margin
}: Props) {
  const stopAt = experiment.statusUpdateSchedule?.stopAt;
  const scheduledEndPassed =
    experiment.status === "running" &&
    !!stopAt &&
    new Date(stopAt) <= new Date();

  // Decisive statuses are covered by RunningExperimentDecisionBanner.
  const status = runningExperimentStatus?.status;
  const hasDecision =
    status === "ship-now" ||
    status === "rollback-now" ||
    status === "ready-for-review";

  if (!scheduledEndPassed || !runningExperimentStatus || hasDecision) {
    return null;
  }

  return (
    <ExperimentBanner
      headline={
        <>
          <PiClockFill
            size={16}
            style={{ color: "var(--amber-11)", flexShrink: 0 }}
          />
          <Text color="text-mid">Past its scheduled end, {date(stopAt)}</Text>
          <Text color="text-low">·</Text>
          <Text color="text-low">No clear recommendation</Text>
        </>
      }
      details={
        <>
          <Text as="div" mb="2">
            The experiment kept running past its scheduled end, as its schedule
            asks. There&apos;s no clear recommendation because:
          </Text>
          <Reason color="amber" icon={<PiWarningCircleBold />}>
            {getReasonText(runningExperimentStatus)}
          </Reason>
          {editSchedule ? (
            <Box mt="3" mb="1">
              <Link onClick={editSchedule}>Edit schedule</Link>
            </Box>
          ) : null}
        </>
      }
      {...margin}
    />
  );
}
