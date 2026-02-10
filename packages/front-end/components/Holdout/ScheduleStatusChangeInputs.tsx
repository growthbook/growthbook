import React from "react";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { UseFormReturn } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { datetime } from "shared/dates";
import { format } from "date-fns";
import DatePicker from "@/components/DatePicker";
import Field from "@/components/Forms/Field";
import Tooltip from "@/ui/Tooltip";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

interface Props {
  form: UseFormReturn<
    Pick<HoldoutInterfaceStringDates, "scheduledStatusUpdates">
  >;
  holdout: HoldoutInterfaceStringDates;
  experiment: ExperimentInterfaceStringDates;
}

const DATE_FORMAT = "Pp";

export default function ScheduleStatusChangeInputs({
  form,
  holdout,
  experiment,
}: Props) {
  const isRunning = experiment.status === "running";
  const isStopped = experiment.status === "stopped";
  const isArchived = experiment.archived;

  const holdoutStatus =
    experiment.status === "draft"
      ? "draft"
      : isRunning && !holdout.analysisStartDate
        ? "running"
        : isRunning && holdout.analysisStartDate
          ? "analysis-period"
          : "stopped";

  const startDate = form.watch("scheduledStatusUpdates.startAt");
  const startAnalysisPeriodDate = form.watch(
    "scheduledStatusUpdates.startAnalysisPeriodAt",
  );
  const stopDate = form.watch("scheduledStatusUpdates.stopAt");

  return (
    <Box my="4">
      <Box mb="2">
        <Text weight="medium">Start Holdout</Text>
      </Box>

      {!isRunning && !isStopped && !isArchived ? (
        <Flex direction="row" gap="2" align="baseline">
          <Box flexGrow="1">
            <DatePicker
              date={form.watch("scheduledStatusUpdates.startAt")}
              setDate={(d) => {
                form.setValue(
                  "scheduledStatusUpdates.startAt",
                  d ? datetime(d) : undefined,
                );
              }}
              scheduleEndDate={form.watch(
                "scheduledStatusUpdates.startAnalysisPeriodAt",
              )}
            />
          </Box>
          <Button
            color="red"
            disabled={!startDate}
            variant="ghost"
            size="sm"
            onClick={() => {
              form.setValue("scheduledStatusUpdates.startAt", "");
            }}
          >
            Clear
          </Button>
        </Flex>
      ) : (
        <Box mb="4">
          <Tooltip content="The Holdout has already started—this date cannot be edited">
            <Field
              value={
                experiment.phases[0].dateStarted
                  ? format(
                      new Date(experiment.phases[0].dateStarted),
                      DATE_FORMAT,
                    )
                  : startDate
                    ? format(new Date(startDate), DATE_FORMAT)
                    : ""
              }
              disabled
            />
          </Tooltip>
        </Box>
      )}

      <Box my="2">
        <Text weight="medium">Stop Holdout & Start Analysis</Text>
      </Box>

      {!isStopped && holdoutStatus !== "analysis-period" && !isArchived ? (
        <Flex direction="row" gap="2" align="baseline">
          <Box flexGrow="1">
            <DatePicker
              date={form.watch("scheduledStatusUpdates.startAnalysisPeriodAt")}
              setDate={(d) => {
                form.setValue(
                  "scheduledStatusUpdates.startAnalysisPeriodAt",
                  d ? datetime(d) : undefined,
                );
              }}
              scheduleStartDate={form.watch("scheduledStatusUpdates.startAt")}
            />
          </Box>
          <Button
            color="red"
            disabled={!startAnalysisPeriodDate}
            variant="ghost"
            size="sm"
            onClick={() => {
              form.setValue("scheduledStatusUpdates.startAnalysisPeriodAt", "");
            }}
          >
            Clear
          </Button>
        </Flex>
      ) : (
        <Box mb="4">
          <Tooltip content="The Analysis Phase has already started—this date cannot be edited">
            <Field
              value={
                holdout.analysisStartDate
                  ? format(new Date(holdout.analysisStartDate), DATE_FORMAT)
                  : startAnalysisPeriodDate
                    ? format(new Date(startAnalysisPeriodDate), DATE_FORMAT)
                    : ""
              }
              disabled
            />
          </Tooltip>
        </Box>
      )}

      <Box my="2">
        <Text weight="medium">Stop Analysis</Text>
      </Box>
      {!isStopped && !isArchived ? (
        <Flex direction="row" gap="2" align="baseline">
          <Box flexGrow="1">
            <DatePicker
              date={form.watch("scheduledStatusUpdates.stopAt")}
              setDate={(d) => {
                form.setValue(
                  "scheduledStatusUpdates.stopAt",
                  d ? datetime(d) : undefined,
                );
              }}
              scheduleStartDate={form.watch(
                "scheduledStatusUpdates.startAnalysisPeriodAt",
              )}
            />
          </Box>
          <Button
            color="red"
            disabled={!stopDate}
            variant="ghost"
            size="sm"
            onClick={() => {
              form.setValue("scheduledStatusUpdates.stopAt", "");
            }}
          >
            Clear
          </Button>
        </Flex>
      ) : (
        <Box mb="4">
          <Tooltip content="The Analysis Phase has already ended—this date cannot be edited">
            <Field
              value={
                experiment.phases[1]?.dateEnded
                  ? format(
                      new Date(experiment.phases[1]?.dateEnded),
                      DATE_FORMAT,
                    )
                  : stopDate
                    ? format(new Date(stopDate), DATE_FORMAT)
                    : ""
              }
              disabled
            />
          </Tooltip>
        </Box>
      )}
    </Box>
  );
}
