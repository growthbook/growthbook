import { format as formatTimeZone } from "date-fns-tz";
import React from "react";
import { HoldoutInterface } from "shared/validators";
import { Box, Flex, Text } from "@radix-ui/themes";
import { UseFormReturn } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { format } from "date-fns";
import { getValidDate } from "shared/dates";
import DatePicker from "@/components/DatePicker";
import Callout from "@/ui/Callout";
import Field from "@/components/Forms/Field";

interface Props {
  form: UseFormReturn<Pick<HoldoutInterface, "scheduledStatusUpdates">>;
  holdout: HoldoutInterface;
  experiment: ExperimentInterfaceStringDates;
}

export default function ScheduleStatusChangeInputs({
  form,
  holdout,
  experiment,
}: Props) {
  const isRunning = experiment.status === "running";
  const isStopped = experiment.status === "stopped";

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

  const dateFormat = "MM/dd/yyyy, hh:mm a";

  const dateError =
    (startDate &&
      startAnalysisPeriodDate &&
      startDate > startAnalysisPeriodDate) ||
    (startDate && stopDate && startDate > stopDate) ||
    (startAnalysisPeriodDate && stopDate && startAnalysisPeriodDate > stopDate);

  return (
    <Box my="4">
      <div className="box mb-3 bg-light pt-2 px-3">
        <Flex direction="row" align="baseline" gap="4">
          <Text size="2" weight="medium">
            Start at
          </Text>

          <Flex direction="row" align="center">
            {!isRunning && !isStopped ? (
              <DatePicker
                date={form.watch("scheduledStatusUpdates.startAt")}
                setDate={(d) => {
                  form.setValue("scheduledStatusUpdates.startAt", d);
                }}
                disableBefore={new Date()}
                scheduleEndDate={form.watch(
                  "scheduledStatusUpdates.startAnalysisPeriodAt",
                )}
              />
            ) : (
              <Box mb="4">
                <Field
                  value={
                    holdout.scheduledStatusUpdates?.startAt
                      ? format(
                          getValidDate(holdout.scheduledStatusUpdates?.startAt),
                          dateFormat,
                        )
                      : ""
                  }
                  disabled
                />
              </Box>
            )}
            <span className="pl-2">({formatTimeZone(new Date(), "z")})</span>
          </Flex>
        </Flex>
        <Flex direction="row" align="baseline" gap="4">
          <Text size="2" weight="medium">
            Start analysis period at
          </Text>

          <Flex direction="row" align="center">
            {!isStopped && holdoutStatus !== "analysis-period" ? (
              <DatePicker
                date={form.watch(
                  "scheduledStatusUpdates.startAnalysisPeriodAt",
                )}
                setDate={(d) => {
                  form.setValue(
                    "scheduledStatusUpdates.startAnalysisPeriodAt",
                    d,
                  );
                }}
                disableBefore={new Date()}
                scheduleStartDate={form.watch("scheduledStatusUpdates.startAt")}
              />
            ) : (
              <Box mb="4">
                <Field
                  value={format(
                    getValidDate(
                      holdout.scheduledStatusUpdates?.startAnalysisPeriodAt,
                    ),
                    dateFormat,
                  )}
                  disabled
                />
              </Box>
            )}
            <span className="pl-2">({formatTimeZone(new Date(), "z")})</span>
          </Flex>
        </Flex>
        <Flex direction="row" align="baseline" gap="4">
          <Text size="2" weight="medium">
            Stop at
          </Text>

          <Flex direction="row" align="center">
            <DatePicker
              date={form.watch("scheduledStatusUpdates.stopAt")}
              setDate={(d) => {
                form.setValue("scheduledStatusUpdates.stopAt", d);
              }}
              disableBefore={new Date()}
              scheduleStartDate={form.watch(
                "scheduledStatusUpdates.startAnalysisPeriodAt",
              )}
            />
            <span className="pl-2">({formatTimeZone(new Date(), "z")})</span>
          </Flex>
        </Flex>
        {dateError && (
          <Callout status="error" mb="4">
            Dates must be consecutive.
          </Callout>
        )}
      </div>
    </Box>
  );
}
