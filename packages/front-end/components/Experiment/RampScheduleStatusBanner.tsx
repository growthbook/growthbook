/**
 * RampScheduleStatusBanner
 *
 * An expandable "Schedule" appbox on the experiment overview. Collapsed, it
 * summarizes the experiment's schedule as a whole — scheduled start/end and, if
 * a ramp is attached, the current ramp state. Expanded (caret), it reveals the
 * full read-only ramp timeline inline. Ramp playback controls live in the
 * experiment's actions dropdown, not here.
 */
import { Box, Flex } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import { FaAngleRight, FaExclamationTriangle } from "react-icons/fa";
import { PiCalendarBlank } from "react-icons/pi";
import {
  RampScheduleInterface,
  EffectiveRampStatus,
  getEffectiveRampStatus,
  isAwaitingApproval,
} from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { date } from "shared/dates";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import useApi from "@/hooks/useApi";
import RampTimeline from "@/components/RampSchedule/RampTimeline";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  // Kept for parity with the parent header API; this read-only banner doesn't
  // mutate the experiment, so it's intentionally unused here.
  mutate: () => void;
  // Opens the schedule editor (dates + ramp steps + remove). Null when the user
  // can't edit the experiment. The editor handles removing the ramp (toggle off)
  // and editing start/end dates.
  editSchedule?: (() => void) | null;
}

// Keyed on the derived effective status (experiment liveness + ramp status),
// not the stored ramp status alone — so a ramp never reads as "Ramping" off a
// non-running experiment.
const STATUS_COLORS: Record<
  EffectiveRampStatus,
  "indigo" | "yellow" | "green" | "red" | "gray"
> = {
  "not-started": "yellow",
  ramping: "indigo",
  paused: "yellow",
  completed: "green",
  "rolled-back": "red",
  inactive: "gray",
};

const STATUS_LABELS: Record<EffectiveRampStatus, string> = {
  "not-started": "Scheduled",
  ramping: "Ramping",
  paused: "Paused",
  completed: "Completed",
  "rolled-back": "Rolled back",
  inactive: "Inactive",
};

export default function RampScheduleStatusBanner({
  experiment,
  editSchedule,
}: Props) {
  const { data } = useApi<{
    rampSchedule: RampScheduleInterface | null;
  }>(`/experiment/${experiment.id}/ramp-schedule`);

  const schedule = data?.rampSchedule;
  if (!experiment.rampScheduleId || !schedule) return null;

  // Effective state factors in experiment liveness, so a ramp can't display as
  // "ramping" before the experiment starts (or after it stops).
  const effective = getEffectiveRampStatus(experiment.status, schedule);
  const notStarted = effective === "not-started";
  const awaitingApproval =
    effective === "ramping" && isAwaitingApproval(schedule);
  const totalSteps = schedule.steps.length;

  // The experiment's scheduled start/end live on the experiment, not the ramp
  // (the ramp's own startDate/cutoffDate are feature-only). Start = the ramp's
  // actual start (startedAt) once running, else the experiment's scheduled
  // start; end = the experiment's scheduled stop (absent = runs until stopped).
  const startAt =
    schedule.startedAt ?? experiment.statusUpdateSchedule?.startAt ?? null;
  const endAt = experiment.statusUpdateSchedule?.stopAt ?? null;

  // ── Compact summary: lead with the experiment's start/end (most important);
  // the ramp is secondary. Order shifts with lifecycle:
  //   before start → starts · ramp-up · ends
  //   while ramping → ramp position · ends (start already happened)
  //   after ramp    → ramp complete · ends
  const endPart = endAt ? `Experiment ends ${date(endAt)}` : "No scheduled end";
  const summaryParts: string[] = [];
  if (effective === "completed") {
    summaryParts.push("Ramp complete", endPart);
  } else if (effective === "rolled-back") {
    if (schedule.lastRollbackReason)
      summaryParts.push(schedule.lastRollbackReason);
  } else if (notStarted) {
    if (startAt) summaryParts.push(`Experiment starts ${date(startAt)}`);
    summaryParts.push(`${totalSteps}-step ramp-up`, endPart);
  } else {
    if (schedule.currentStepIndex >= 0) {
      summaryParts.push(
        `Ramp step ${schedule.currentStepIndex + 1} of ${totalSteps}`,
      );
    }
    summaryParts.push(endPart);
  }
  const summary = summaryParts.join(" · ");

  return (
    <div className="appbox p-3">
      <Box>
        <Collapsible
          transitionTime={100}
          trigger={
            <Flex
              direction="row"
              align="center"
              justify="between"
              style={{ cursor: "pointer" }}
            >
              <Flex align="center" gap="2" wrap="wrap">
                <PiCalendarBlank style={{ color: "var(--color-text-mid)" }} />
                <Text weight="medium">Schedule</Text>
                <Badge
                  color={STATUS_COLORS[effective]}
                  label={STATUS_LABELS[effective]}
                />
                {summary && (
                  <Text size="medium" color="gray">
                    {summary}
                  </Text>
                )}
                {awaitingApproval && (
                  <Badge
                    color="orange"
                    variant="soft"
                    label={
                      <>
                        <FaExclamationTriangle style={{ marginRight: 4 }} />
                        Awaiting approval
                      </>
                    }
                  />
                )}
              </Flex>
              <Flex align="center" gap="3">
                {editSchedule && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async (e) => {
                      // Don't let the click toggle the collapsible.
                      e?.stopPropagation();
                      // Editing a live experiment's schedule/ramp changes it
                      // in place — confirm first.
                      if (
                        experiment.status === "running" &&
                        !window.confirm(
                          "This experiment is running. Editing its schedule or ramp changes a live experiment. Continue?",
                        )
                      ) {
                        return;
                      }
                      editSchedule();
                    }}
                  >
                    Edit
                  </Button>
                )}
                <FaAngleRight className="chevron" />
              </Flex>
            </Flex>
          }
        >
          <>
            <hr className="mt-3" />
            <RampTimeline
              rs={schedule}
              displayStartDate={startAt}
              displayEndDate={endAt}
              experimentStatus={experiment.status}
            />
          </>
        </Collapsible>
      </Box>
    </div>
  );
}
