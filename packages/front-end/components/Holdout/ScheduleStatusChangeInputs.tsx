import React from "react";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { Box, Text } from "@radix-ui/themes";
import { UseFormReturn } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { format } from "date-fns";
import { datetime } from "shared/dates";
import DatePicker from "@/components/DatePicker";
import Callout from "@/ui/Callout";
import Field from "@/components/Forms/Field";
import Tooltip from "@/ui/Tooltip";

interface Props {
  form: UseFormReturn<
    Pick<HoldoutInterfaceStringDates, "scheduledStatusUpdates">
  >;
  holdout: HoldoutInterfaceStringDates;
  experiment: ExperimentInterfaceStringDates;
}

const DATE_FORMAT = "yyyy-MM-dd'T'HH:mm";

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

  const dateError =
    (startDate &&
      startAnalysisPeriodDate &&
      startDate > startAnalysisPeriodDate) ||
    (startDate && stopDate && startDate > stopDate) ||
    (startAnalysisPeriodDate && stopDate && startAnalysisPeriodDate > stopDate);

  return (
    <Box my="4">
      <Box mb="2">
        <Text size="2" weight="medium">
          Start Holdout
        </Text>
      </Box>

      {!isRunning && !isStopped && !isArchived ? (
        <DatePicker
          date={form.watch("scheduledStatusUpdates.startAt")}
          setDate={(d) => {
            form.setValue(
              "scheduledStatusUpdates.startAt",
              d ? datetime(d) : "",
            );
          }}
          disableBefore={new Date()}
          scheduleEndDate={form.watch(
            "scheduledStatusUpdates.startAnalysisPeriodAt",
          )}
        />
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
        <Text size="2" weight="medium">
          Stop Holdout & Start Analysis
        </Text>
      </Box>

      {!isStopped && holdoutStatus !== "analysis-period" && !isArchived ? (
        <DatePicker
          date={form.watch("scheduledStatusUpdates.startAnalysisPeriodAt")}
          setDate={(d) => {
            form.setValue(
              "scheduledStatusUpdates.startAnalysisPeriodAt",
              d ? datetime(d) : "",
            );
          }}
          disableBefore={new Date()}
          scheduleStartDate={form.watch("scheduledStatusUpdates.startAt")}
        />
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
        <Text size="2" weight="medium">
          Stop Analysis
        </Text>
      </Box>
      {!isStopped && !isArchived ? (
        <DatePicker
          date={form.watch("scheduledStatusUpdates.stopAt")}
          setDate={(d) => {
            form.setValue(
              "scheduledStatusUpdates.stopAt",
              d ? datetime(d) : "",
            );
          }}
          disableBefore={new Date()}
          scheduleStartDate={form.watch(
            "scheduledStatusUpdates.startAnalysisPeriodAt",
          )}
        />
      ) : (
        <Box mb="4">
          <Tooltip content="The Analysis Phase has already ended—this date cannot be edited">
            <Field
              value={
                experiment.phases[1].dateEnded
                  ? format(
                      new Date(experiment.phases[1].dateEnded),
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
      {dateError && (
        <Callout status="error" mb="4">
          Dates must be consecutive.
        </Callout>
      )}
    </Box>
  );
}
