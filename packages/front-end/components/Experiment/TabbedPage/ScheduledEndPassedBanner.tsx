import { Flex, Box, Separator } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
} from "shared/types/experiment";
import { format } from "date-fns-tz";
import { BsLightningFill } from "react-icons/bs";
import Collapsible from "react-collapsible";
import { PiCaretRight } from "react-icons/pi";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  runningExperimentStatus?: ExperimentResultStatusData;
  editSchedule?: () => void;
}

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

  if (!scheduledEndPassed || !status || hasDecision) return null;

  return (
    <Box className="appbox" p="3">
      <Collapsible
        trigger={
          <Flex direction="row" align="center" justify="between">
            <Box>
              <Flex direction="row" align="center" gap="1">
                <BsLightningFill color="var(--warning)" />
                <Text weight="semibold">Scheduled end passed:</Text>
                <Box ml="1">
                  <Text>No clear recommendation</Text>
                </Box>
              </Flex>
            </Box>
            <Link>
              <Flex align="center" gap="1">
                <Text>View details</Text>
                <PiCaretRight className="chevron" />
              </Flex>
            </Link>
          </Flex>
        }
        transitionTime={100}
      >
        <>
          <Separator size="4" mt="3" />
          <Box mt="4" ml="3">
            <Flex direction="column" gap="4">
              <Text as="p" size="medium">
                This experiment passed its scheduled end date on{" "}
                {format(new Date(stopAt), "MMM d, yyyy 'at' h:mm a (z)")} and
                was kept running as requested by the experiment schedule.
              </Text>
              <Text as="p" size="medium">
                There is no clear decision recommendation for the following
                reason(s):
              </Text>
            </Flex>
            <Flex direction="column" gap="2" mt="2">
              <Flex gap="2" align="center">
                <Text size="medium" color="text-mid">
                  •
                </Text>
                <Text size="medium">
                  {getReasonText(runningExperimentStatus)}
                </Text>
              </Flex>
            </Flex>
            {editSchedule ? (
              <Box mt="4" mb="2">
                <Link onClick={editSchedule}>Edit schedule</Link>
              </Box>
            ) : null}
          </Box>
        </>
      </Collapsible>
    </Box>
  );
}
