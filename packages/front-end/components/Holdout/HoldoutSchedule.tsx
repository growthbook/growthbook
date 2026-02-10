import { Flex, Box } from "@radix-ui/themes";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
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

function pickEarlierDate(
  date1: string | undefined,
  date2: string | undefined,
): Date | null {
  if (!date1 && date2) return new Date(date2);
  if (date1 && !date2) return new Date(date1);

  if (!date1 || !date2) return null;

  return new Date(date1) < new Date(date2) ? new Date(date1) : new Date(date2);
}

function getCompletion(startDate: Date | null, endDate: Date | null): number {
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
  const startDate =
    experiment.status !== "draft"
      ? pickEarlierDate(
          holdout.scheduledStatusUpdates?.startAt,
          experiment.phases[0]?.dateStarted,
        )
      : holdout.scheduledStatusUpdates?.startAt
        ? new Date(holdout.scheduledStatusUpdates?.startAt)
        : null;
  const startAnalysisPeriodDate = pickEarlierDate(
    holdout.scheduledStatusUpdates?.startAnalysisPeriodAt,
    holdout.analysisStartDate,
  );
  const stopDate = pickEarlierDate(
    holdout.scheduledStatusUpdates?.stopAt,
    experiment.phases[1]?.dateEnded,
  );

  const isDraft = experiment.status === "draft";
  const isRunning = experiment.status === "running";
  const showUnscheduledSegment =
    (isDraft && (!startAnalysisPeriodDate || !stopDate)) ||
    (isRunning && !startAnalysisPeriodDate);
  const isInAnalysisPeriod = isRunning && holdout.analysisStartDate;

  const holdoutSegmentCompletion = getCompletion(
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
        : 68,
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
      weight: showUnscheduledSegment ? 0 : 32,
      completion: getCompletion(startAnalysisPeriodDate, stopDate),
      color: isInAnalysisPeriod ? "amber" : isDraft ? "slate" : "indigo",
    },
  ];

  const dateRangeColor =
    experiment.status === "draft" ? "text-mid" : "text-low";

  return (
    <>
      <ProgressBar
        segments={
          experiment.status !== "stopped"
            ? segments
            : [COMPLETED_HOLDOUT_SEGMENT]
        }
      />
      <Flex justify="between">
        <Box>
          {experiment.status === "draft" ? (
            <>
              <Text weight="medium" color="text-high">
                Start:{" "}
              </Text>
              <Text
                color={startDate ? "text-high" : "text-disabled"}
                weight="regular"
              >
                {startDate
                  ? format(startDate, "MMM d, yyyy 'at' h:mm a")
                  : "Not scheduled"}
              </Text>
            </>
          ) : experiment.status === "running" ? (
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
                  {holdout.analysisStartDate ? "Analyzing..." : "Running..."}
                </Text>
              </Box>
              <Box
                className={styles.animateStatusMessage}
                inset="0"
                position="absolute"
              >
                <Text color="text-high" weight="regular">
                  {holdout.analysisStartDate
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
          {experiment.status === "draft" ||
          (experiment.status === "running" && !holdout.analysisStartDate) ? (
            <>
              <Text
                weight="medium"
                color={experiment.status === "draft" ? "text-high" : "text-low"}
              >
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
                      experiment.status === "draft" && !stopDate
                        ? "text-disabled"
                        : dateRangeColor
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
          ) : experiment.status === "running" && holdout.analysisStartDate ? (
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
