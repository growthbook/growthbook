import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Flex } from "@radix-ui/themes";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { PiPencilSimple, PiPlus, PiWarningFill } from "react-icons/pi";
import { format } from "date-fns-tz";
import { PreLaunchChecklistDrawer } from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import useExperimentEditing from "@/components/Experiment/TabbedPage/useExperimentEditing";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import HoldoutTimeline from "@/components/Experiment/holdout/HoldoutTimeline";
import HypothesisField from "@/components/Experiment/TabbedPage/HypothesisField";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import { HoldoutSchedule } from "@/components/Holdout/HoldoutSchedule";
import Heading from "@/ui/Heading";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterfaceStringDates;
  holdoutExperiments?: ExperimentInterfaceStringDates[];
  mutate: () => void;
  disableEditing?: boolean;
  editSchedule?: (() => void) | null;
}

export default function SetupTabOverview({
  experiment,
  holdout,
  holdoutExperiments,
  mutate,
  disableEditing,
  editSchedule,
}: Props) {
  const { apiCall } = useAuth();
  const { canEdit: canEditExperiment, editInline: editingInline } =
    useExperimentEditing(experiment, disableEditing);

  const isBandit = experiment.type === "multi-armed-bandit";
  const isHoldout = experiment.type === "holdout";
  const showHoldoutTimeline =
    isHoldout &&
    holdout &&
    experiment.status !== "draft" &&
    holdoutExperiments &&
    experiment.phases[0]?.dateStarted &&
    new Date(experiment.phases[0].dateStarted) &&
    holdoutExperiments.length > 0 &&
    holdoutExperiments.some((e) => e.status !== "draft");
  const canEditSchedule = !isBandit && canEditExperiment && editSchedule;
  const holdoutHasSchedule =
    isHoldout &&
    holdout &&
    Object.values(holdout.statusUpdateSchedule ?? {}).some(
      (value) => value !== null,
    );
  const experimentHasSchedule =
    experiment.statusUpdateSchedule &&
    Object.values(experiment.statusUpdateSchedule).some(
      (value) => value !== null,
    );
  const experimentScheduleApproved = !!experiment.nextScheduledStatusUpdate;
  const showScheduleIsInThePastWarning =
    !!experiment.statusUpdateSchedule?.startAt &&
    new Date(experiment.statusUpdateSchedule.startAt) < new Date();

  // One-line summary of the draft schedule — start and/or end (absolute stopAt
  // or a deferred relative stopAfter), so an end-only schedule still shows.
  const schedule = experiment.statusUpdateSchedule;
  const scheduleSummaryParts: string[] = [];
  if (schedule?.startAt) {
    scheduleSummaryParts.push(
      `Start ${format(new Date(schedule.startAt), "MMM d, yyyy 'at' h:mm a (z)")}`,
    );
  }
  if (schedule?.stopAt) {
    scheduleSummaryParts.push(
      `End ${format(new Date(schedule.stopAt), "MMM d, yyyy 'at' h:mm a (z)")}`,
    );
  } else if (schedule?.stopAfter) {
    scheduleSummaryParts.push(
      `End ${schedule.stopAfter.value} ${schedule.stopAfter.unit} after start`,
    );
  }
  const scheduleSummary = scheduleSummaryParts.join(" · ");

  // End-only summary for a running experiment (start is already in the past, and
  // any relative stopAfter was resolved to a concrete stopAt at start). A
  // passed end date means a notify-mode end already fired and deliberately kept
  // the experiment running — say so instead of implying a future stop.
  const scheduledEndPassed =
    experiment.status === "running" &&
    !!schedule?.stopAt &&
    new Date(schedule.stopAt) <= new Date();
  const scheduledEndSummary = schedule?.stopAt
    ? scheduledEndPassed
      ? `Ended ${format(new Date(schedule.stopAt), "MMM d, yyyy 'at' h:mm a (z)")} — kept running`
      : `Ends ${format(new Date(schedule.stopAt), "MMM d, yyyy 'at' h:mm a (z)")}`
    : schedule?.stopAfter
      ? `Ends ${schedule.stopAfter.value} ${schedule.stopAfter.unit} after start`
      : null;

  // Running experiments can add/edit an end date + end-of-experiment shipping
  // automation mid-flight (start is already past).
  const showEditRunningSchedule =
    canEditSchedule &&
    !isHoldout &&
    !isBandit &&
    experiment.status === "running" &&
    !experiment.archived;

  const showDraftScheduleSummary =
    experiment.status === "draft" &&
    experiment.type !== "holdout" &&
    !!experimentHasSchedule &&
    !experimentScheduleApproved &&
    !!editSchedule;

  return (
    <>
      <div>
        {showDraftScheduleSummary || showEditRunningSchedule ? (
          <Flex justify="end" align="baseline" mb="3">
            <Flex align="center" gap="4">
              {showDraftScheduleSummary && editSchedule ? (
                <Tooltip
                  content="Scheduled start date has passed—edit scheduled time"
                  enabled={showScheduleIsInThePastWarning}
                >
                  <Link onClick={() => editSchedule()}>
                    <Flex align="center" gap="1">
                      {showScheduleIsInThePastWarning && (
                        <PiWarningFill color="var(--warning)" />
                      )}
                      <Text weight="semibold">{scheduleSummary}</Text>
                      <PiPencilSimple />
                    </Flex>
                  </Link>
                </Tooltip>
              ) : null}
              {showEditRunningSchedule ? (
                <Link onClick={() => editSchedule()}>
                  <Flex align="center" gap="1">
                    {scheduledEndPassed && (
                      <PiWarningFill color="var(--warning)" />
                    )}
                    {!experimentHasSchedule && <PiPlus size="15" />}
                    <Text weight="semibold">
                      {scheduledEndSummary ??
                        (experimentHasSchedule
                          ? "Edit Schedule"
                          : "Add Schedule End")}
                    </Text>
                    {experimentHasSchedule && <PiPencilSimple />}
                  </Flex>
                </Link>
              ) : null}
            </Flex>
          </Flex>
        ) : null}
        {isHoldout && holdout && holdoutHasSchedule && editSchedule ? (
          <Frame id="holdout-schedule" style={{ scrollMarginTop: "100px" }}>
            <Flex align="center" justify="between" className="text-dark">
              <Heading color="text-high" mb="0" as="h4" size="sm">
                Holdout Schedule
              </Heading>
              <Flex align="center" gap="2">
                {canEditSchedule ? (
                  <>
                    <DeleteButton
                      text="Delete"
                      displayName="Schedule"
                      deleteMessage="Deleting the schedule will remove the automatic transition of the Holdout from start, to analysis, to stopped. Manual intervention will be required for each transition if no schedule is set."
                      onClick={async () => {
                        await apiCall<HoldoutInterfaceStringDates>(
                          `/holdout/${holdout.id}`,
                          {
                            method: "PUT",
                            body: JSON.stringify({
                              statusUpdateSchedule: null,
                              nextScheduledStatusUpdate: null,
                            }),
                          },
                        );
                        mutate();
                      }}
                    />
                    <Link
                      mr={experiment.description ? "3" : "0"}
                      onClick={(e) => {
                        e.stopPropagation();
                        editSchedule();
                      }}
                    >
                      <Text weight="semibold">Edit</Text>
                    </Link>
                  </>
                ) : null}
              </Flex>
            </Flex>
            <HoldoutSchedule holdout={holdout} experiment={experiment} />
          </Frame>
        ) : null}

        {showHoldoutTimeline && (
          <div className="box p-4 my-4">
            <HoldoutTimeline
              experiments={holdoutExperiments}
              startDate={
                experiment.phases[0]?.dateStarted
                  ? new Date(experiment.phases[0].dateStarted)
                  : new Date()
              }
              holdoutEndDate={
                experiment.phases[0]?.dateEnded
                  ? new Date(experiment.phases[0].dateEnded)
                  : undefined
              }
            />
          </div>
        )}

        {!isBandit && !isHoldout && (
          <HypothesisField experiment={experiment} editable={editingInline} />
        )}
      </div>
      {experiment.status === "draft" && experiment.type !== "holdout" && (
        <PreLaunchChecklistDrawer />
      )}
    </>
  );
}
