import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Plural, Trans } from "@lingui/react/macro";
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
      <Trans>Edit schedule</Trans>
    </Button>
  ) : null;
  const nextStep = editSchedule ? null : (
    <>
      {" "}
      <Trans>Ask someone who can edit this experiment to reschedule it.</Trans>
    </>
  );

  if (failure) {
    const gaveUpAt = scheduledTime(failure.date);
    const reason = failure.reason;
    return (
      <Callout
        status="error"
        contentAlign="center"
        mt="2"
        mb="4"
        action={action}
      >
        {failure.type === "start" ? (
          <Trans>
            The scheduled start didn&apos;t happen (gave up {gaveUpAt}):{" "}
            {reason}
          </Trans>
        ) : (
          <Trans>
            The scheduled stop didn&apos;t happen (gave up {gaveUpAt}): {reason}
          </Trans>
        )}
        {nextStep}
      </Callout>
    );
  }
  if (retrying?.failedAttempts && retrying.lastError) {
    const scheduledFor = scheduledTime(retrying.date);
    const attempts = retrying.failedAttempts;
    const lastError = retrying.lastError;
    return (
      <Callout
        status="warning"
        contentAlign="center"
        mt="2"
        mb="4"
        action={action}
      >
        {retrying.type === "start" ? (
          <Trans>
            The start scheduled for {scheduledFor} failed{" "}
            <Plural value={attempts} one="# time" other="# times" /> and will
            retry: {lastError}
          </Trans>
        ) : (
          <Trans>
            The stop scheduled for {scheduledFor} failed{" "}
            <Plural value={attempts} one="# time" other="# times" /> and will
            retry: {lastError}
          </Trans>
        )}
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
        <Trans>
          The scheduled start locks what launches: targeting, traffic,
          variations, and the experiment key. Unschedule it to change them.
        </Trans>
      </Callout>
    );
  }
  return null;
}
