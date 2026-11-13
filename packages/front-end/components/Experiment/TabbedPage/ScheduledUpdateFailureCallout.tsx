import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { armedStartDate, scheduledTime } from "./statusSchedule";

// A scheduled start or stop that's failing to apply, or that the job gave up
// on; otherwise a scheduled start, which locks what launches.
export default function ScheduledUpdateFailureCallout({
  experiment,
  editSchedule,
}: {
  experiment: ExperimentInterfaceStringDates;
  editSchedule?: (() => void) | null;
}) {
  const failure = experiment.scheduledStatusUpdateFailure;
  const retrying = experiment.nextScheduledStatusUpdate;
  const action = editSchedule ? (
    <Button variant="outline" size="sm" onClick={editSchedule}>
      Edit schedule
    </Button>
  ) : null;
  const nextStep = editSchedule
    ? ""
    : " Ask someone who can edit this experiment to reschedule it.";

  if (failure) {
    return (
      <Callout
        status="error"
        contentAlign="center"
        mt="2"
        mb="4"
        action={action}
      >
        The scheduled {failure.type} didn&apos;t happen (gave up{" "}
        {scheduledTime(failure.date)}): {failure.reason}
        {nextStep}
      </Callout>
    );
  }
  if (retrying?.failedAttempts && retrying.lastError) {
    return (
      <Callout
        status="warning"
        contentAlign="center"
        mt="2"
        mb="4"
        action={action}
      >
        The {retrying.type} scheduled for {scheduledTime(retrying.date)} failed{" "}
        {retrying.failedAttempts}{" "}
        {retrying.failedAttempts === 1 ? "time" : "times"} and will retry:{" "}
        {retrying.lastError}
      </Callout>
    );
  }
  if (editSchedule && armedStartDate(experiment)) {
    return (
      <Callout
        status="info"
        contentAlign="center"
        mt="2"
        mb="4"
        action={action}
      >
        The scheduled start locks what launches: targeting, traffic, variations,
        and the experiment key. Unschedule it to change them.
      </Callout>
    );
  }
  return null;
}
