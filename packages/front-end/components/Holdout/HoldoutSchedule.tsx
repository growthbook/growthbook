import { Text, Flex, Box } from "@radix-ui/themes";
import clsx from "clsx";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { format, differenceInDays } from "date-fns";
import { ProgressBar } from "@/ui/ProgressBar";

function pickEarlierDate(
  date1: string | undefined,
  date2: string | undefined,
): Date | null {
  if (!date1 && date2) return new Date(date2);
  if (date1 && !date2) return new Date(date1);

  if (!date1 || !date2) return null;

  return new Date(date1) < new Date(date2) ? new Date(date1) : new Date(date2);
}

function getSegmentWeights(
  startDate: Date | null,
  startAnalysisPeriodDate: Date | null,
  stopDate: Date | null,
): [number, number, number] {
  if (!startDate) return [0, 0, 100]; // Empty Schedule - 100% of the way through
  if (startDate && !startAnalysisPeriodDate) return [50, 0, 50]; // Only Start Date - 50% of the way through since we don't know the end date
  if (startDate && startAnalysisPeriodDate && !stopDate) return [40, 40, 20]; // Start Date and Start Analysis Period Date - 40% of the way through for the first segment and 40% of the way through for the second segment since we don't know the end date

  // By this point we should have all three dates, so we can calculate the weights
  if (startDate && startAnalysisPeriodDate && stopDate) {
    const firstSegmentWeight =
      (differenceInDays(startAnalysisPeriodDate, startDate) /
        differenceInDays(stopDate, startDate)) *
      100;
    const secondSegmentWeight =
      (differenceInDays(stopDate, startAnalysisPeriodDate) /
        differenceInDays(stopDate, startDate)) *
      100;
    console.log("firstSegmentWeight", firstSegmentWeight);
    console.log("secondSegmentWeight", secondSegmentWeight);
    return [firstSegmentWeight, secondSegmentWeight, 0];
  }

  return [0, 0, 0]; // This should never happen
}

function getCompletion(startDate: Date | null, endDate: Date | null): number {
  const now = new Date();

  if (!startDate || !endDate) return 0;
  if (now < startDate) return 0;
  if (now > endDate) return 100;

  return (
    (differenceInDays(now, startDate) / differenceInDays(endDate, startDate)) *
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
  const now = new Date();
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

  const [firstSegmentWeight, secondSegmentWeight, thirdSegmentWeight] =
    getSegmentWeights(startDate, startAnalysisPeriodDate, stopDate);

  console.log("firstSegmentWeight", firstSegmentWeight);
  console.log("secondSegmentWeight", secondSegmentWeight);
  console.log("thirdSegmentWeight", thirdSegmentWeight);

  console.log(
    "completion",
    startDate && startAnalysisPeriodDate
      ? now > startAnalysisPeriodDate
        ? 100
        : (differenceInDays(now, startDate) /
            differenceInDays(startAnalysisPeriodDate, startDate)) *
          100
      : 0,
  );

  const segments = [
    {
      id: "1",
      weight: firstSegmentWeight,
      completion: getCompletion(startDate, startAnalysisPeriodDate),
      color: "indigo",
    },
    {
      id: "2",
      weight: secondSegmentWeight,
      completion: getCompletion(startAnalysisPeriodDate, stopDate),
      color: "amber",
    },
    {
      id: "3",
      weight: thirdSegmentWeight,
      completion: 0,
      color: "slate",
    },
  ];

  return (
    <>
      <ProgressBar segments={segments} />
      <Flex justify="between">
        <Box>
          <Text weight="medium">Start: </Text>
          <Text
            className={clsx({
              "text-muted": !startDate,
            })}
          >
            {startDate
              ? format(startDate, "MMM d, yyyy 'at' h:mm a")
              : "Not scheduled"}
          </Text>
        </Box>
        <Box>
          <Text weight="medium">Start Analysis: </Text>
          <Text
            className={clsx({
              "text-muted": !startAnalysisPeriodDate,
            })}
          >
            {startAnalysisPeriodDate
              ? format(startAnalysisPeriodDate, "MMM d, yyyy 'at' h:mm a")
              : "Not scheduled"}
          </Text>
        </Box>
        <Box>
          <Text weight="medium">Stop Analysis: </Text>
          <Text
            className={clsx({
              "text-muted": !stopDate,
            })}
          >
            {stopDate
              ? format(stopDate, "MMM d, yyyy 'at' h:mm a")
              : "Not scheduled"}
          </Text>
        </Box>
      </Flex>
    </>
  );
};
