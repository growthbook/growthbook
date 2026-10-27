import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";

// A scheduled start or stop that's failing to apply, or that the job gave up on.
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
  ) : undefined;

  if (failure) {
    return (
      <Callout
        status="error"
        contentAlign="center"
        mt="2"
        mb="4"
        action={action}
      >
        The scheduled {failure.type} didn&apos;t happen: {failure.reason}
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
        The scheduled {retrying.type} failed {retrying.failedAttempts}{" "}
        {retrying.failedAttempts === 1 ? "time" : "times"} and will retry:{" "}
        {retrying.lastError}
      </Callout>
    );
  }
  return null;
}
