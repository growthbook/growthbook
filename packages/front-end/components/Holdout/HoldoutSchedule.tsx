import { Flex, Box } from "@radix-ui/themes";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getHoldoutStage } from "shared/util";
import { format, differenceInMinutes } from "date-fns";
import { ProgressBar, Segment } from "@/ui/ProgressBar";
import Text from "@/ui/Text";
import styles from "./HoldoutSchedule.module.scss";

const COMPLETED_HOLDOUT_SEGMENT: Segment = {
  id: "1",
  weight: 100,
  completion: 100,
  color: "disabled",
};

// These values are hardcoded to line up with the Analysis label
const NO_STOP_DATE_WEIGHT = 90.5;
const NO_START_ANALYSIS_DATE_WEIGHT = 87;
const HOLDOUT_SEGMENT_WEIGHT = 68;
const ANALYSIS_SEGMENT_WEIGHT = 32;
const UNSCHEDULED_SEGMENT_WEIGHT = 0;

function pickEarlierDate(
  date1: string | undefined,
  date2: string | undefined,
): Date | null {
  const date1Object = date1 ? new Date(date1) : null;
  const date2Object = date2 ? new Date(date2) : null;

  if (!date1Object && date2Object) return date2Object;
  if (date1Object && !date2Object) return date1Object;

  if (!date1Object || !date2Object) return null;

  return date1Object < date2Object ? date1Object : date2Object;
}

function getCompletionPercentage(
  startDate: Date | null,
  endDate: Date | null,
): number {
  const now = new Date();

  if (!startDate || !endDate) return 0;
  if (now < startDate) return 0;
  if (now > endDate) return 100;

  return (
    (differenceInMinutes(now, startDate) /
      differenceInMinutes(endDate, startDate)) *
    100
  );
}

export const HoldoutSchedule = ({
  holdout,
  experiment,
}: {
  holdout: HoldoutInterfaceStringDates;
  experiment: ExperimentInterfaceStringDates;
}) => {
  const holdoutStage = getHoldoutStage(holdout, experiment);
  const startDate =
    holdoutStage !== "draft"
      ? pickEarlierDate(
          holdout.statusUpdateSchedule?.startAt,
          experiment.phases[0]?.dateStarted,
        )
      : holdout.statusUpdateSchedule?.startAt
        ? new Date(holdout.statusUpdateSchedule?.startAt)
        : null;
  const startAnalysisPeriodDate = pickEarlierDate(
    holdout.statusUpdateSchedule?.startAnalysisPeriodAt,
    holdout.analysisStartDate,
  );
  const stopDate = pickEarlierDate(
    holdout.statusUpdateSchedule?.stopAt,
    experiment.phases[1]?.dateEnded,
  );

  const isDraft = holdoutStage === "draft";
  const isRunning = holdoutStage === "running";
  const isInAnalysisPeriod = holdoutStage === "analysis-period";
  const showUnscheduledSegment =
    (isDraft && (!startAnalysisPeriodDate || !stopDate)) ||
    (isRunning && !startAnalysisPeriodDate);

  const holdoutSegmentCompletion = getCompletionPercentage(
    startDate,
    startAnalysisPeriodDate,
  );

  const segments: Segment[] = [
    {
      id: "holdout",
      weight: showUnscheduledSegment
        ? !startAnalysisPeriodDate
          ? NO_START_ANALYSIS_DATE_WEIGHT
          : NO_STOP_DATE_WEIGHT
        : HOLDOUT_SEGMENT_WEIGHT,
      completion: holdoutSegmentCompletion,
      color: isDraft ? "slate" : "indigo",
      endBorder: isDraft ? false : true,
      tooltip:
        holdoutSegmentCompletion === 100
          ? "Holdout has stopped—no new Experiments or Features can be added"
          : undefined,
    },
    {
      id: "analysis",
      weight: showUnscheduledSegment
        ? UNSCHEDULED_SEGMENT_WEIGHT
        : ANALYSIS_SEGMENT_WEIGHT,
      completion: getCompletionPercentage(startAnalysisPeriodDate, stopDate),
      color: isInAnalysisPeriod ? "amber" : isDraft ? "slate" : "indigo",
    },
  ];

  const dateRangeColor = isDraft ? "text-mid" : "text-low";

  return (
    <>
      <ProgressBar
        segments={
          holdoutStage !== "stopped" ? segments : [COMPLETED_HOLDOUT_SEGMENT]
        }
      />
      <Flex justify="between">
        <Box>
          {isDraft ? (
            <>
              <Text weight="medium" color="text-high">
                Start:{" "}
              </Text>
              <Text color={startDate ? "text-high" : "text-disabled"}>
                {startDate
                  ? format(startDate, "MMM d, yyyy 'at' h:mm a")
                  : "Not scheduled"}
              </Text>
            </>
          ) : holdoutStage === "running" ||
            holdoutStage === "analysis-period" ? (
            <Box
              height="20px"
              minWidth="400px"
              overflow="hidden"
              position="relative"
            >
              <Box
                className={styles.animateStatus}
                inset="0"
                position="absolute"
              >
                <Text weight="semibold" color="text-high">
                  {isInAnalysisPeriod ? "Analyzing..." : "Running..."}
                </Text>
              </Box>
              <Box
                className={styles.animateStatusMessage}
                inset="0"
                position="absolute"
              >
                <Text color="text-high" weight="regular">
                  {isInAnalysisPeriod
                    ? "No new experiments or features can be added to Holdout"
                    : "Experiments and features are being added to this Holdout"}
                </Text>
              </Box>
            </Box>
          ) : (
            <Text weight="semibold" color="text-high">
              Holdout stopped
            </Text>
          )}
        </Box>
        <Box>
          {isDraft || isRunning ? (
            <>
              <Text weight="medium" color={isDraft ? "text-high" : "text-low"}>
                Analysis:{" "}
              </Text>
              {startAnalysisPeriodDate ? (
                <>
                  <Text color={dateRangeColor} weight="regular">
                    {format(startAnalysisPeriodDate, "MMM d, yyyy 'at' h:mm a")}{" "}
                    -{" "}
                  </Text>
                  <Text
                    weight="regular"
                    color={
                      isDraft && !stopDate ? "text-disabled" : dateRangeColor
                    }
                  >
                    {stopDate
                      ? format(stopDate, "MMM d, yyyy 'at' h:mm a")
                      : "No end scheduled"}
                  </Text>
                </>
              ) : (
                <Text weight="regular" color="text-disabled">
                  Not scheduled
                </Text>
              )}
            </>
          ) : isInAnalysisPeriod ? (
            <>
              <Text weight="medium" color="text-low">
                Analysis ends:{" "}
              </Text>
              {stopDate ? (
                <>
                  <Text color="text-low" weight="regular">
                    {format(stopDate, "MMM d, yyyy 'at' h:mm a")}
                  </Text>
                </>
              ) : (
                <Text weight="regular" color="text-disabled">
                  Not scheduled
                </Text>
              )}
            </>
          ) : (
            <>
              <Text weight="medium" color="text-low">
                Analysis ended:{" "}
              </Text>
              {stopDate ? (
                <>
                  <Text color="text-low" weight="regular">
                    {format(stopDate, "MMM d, yyyy 'at' h:mm a")}
                  </Text>
                </>
              ) : (
                <Text weight="regular" color="text-disabled">
                  Not scheduled
                </Text>
              )}
            </>
          )}
        </Box>
      </Flex>
    </>
  );
};
