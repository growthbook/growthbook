import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Flex } from "@radix-ui/themes";
import { HoldoutInterfaceStringDates } from "shared/validators";
import useExperimentEditing from "@/components/Experiment/TabbedPage/useExperimentEditing";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import HoldoutTimeline from "@/components/Experiment/holdout/HoldoutTimeline";
import HypothesisField from "@/components/Experiment/TabbedPage/HypothesisField";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import { HoldoutSchedule } from "@/components/Holdout/HoldoutSchedule";
import Heading from "@/ui/Heading";
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
  return (
    <div>
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
        <HypothesisField
          experiment={experiment}
          editable={editingInline}
          canEdit={canEditExperiment}
        />
      )}
    </div>
  );
}
