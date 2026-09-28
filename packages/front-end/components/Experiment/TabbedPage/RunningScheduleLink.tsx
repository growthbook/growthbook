import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Flex } from "@radix-ui/themes";
import { PiPencilSimple, PiPlus, PiWarningFill } from "react-icons/pi";
import { format } from "date-fns-tz";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

/**
 * A running experiment's scheduled end, or the way to add one. The start is
 * already past, and any relative stopAfter resolved to a stopAt when it began.
 */
export default function RunningScheduleLink({
  experiment,
  editSchedule,
}: {
  experiment: ExperimentInterfaceStringDates;
  editSchedule: () => void;
}) {
  const schedule = experiment.statusUpdateSchedule;
  const hasSchedule =
    !!schedule && Object.values(schedule).some((value) => value !== null);
  // A passed end means a notify-mode end already fired and deliberately kept
  // the experiment running, so it says so rather than implying a future stop.
  const endPassed =
    !!schedule?.stopAt && new Date(schedule.stopAt) <= new Date();
  const endSummary = schedule?.stopAt
    ? endPassed
      ? `Ended ${format(new Date(schedule.stopAt), "MMM d, yyyy 'at' h:mm a (z)")} — kept running`
      : `Ends ${format(new Date(schedule.stopAt), "MMM d, yyyy 'at' h:mm a (z)")}`
    : schedule?.stopAfter
      ? `Ends ${schedule.stopAfter.value} ${schedule.stopAfter.unit} after start`
      : null;

  return (
    <Link onClick={editSchedule}>
      <Flex align="center" gap="1">
        {endPassed && <PiWarningFill color="var(--warning)" />}
        {!hasSchedule && <PiPlus size="12" />}
        <Text size="sm">
          {endSummary ?? (hasSchedule ? "Edit Schedule" : "Add Schedule End")}
        </Text>
        {hasSchedule && <PiPencilSimple size="12" />}
      </Flex>
    </Link>
  );
}
