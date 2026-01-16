import { format as formatTimeZone } from "date-fns-tz";
import React, { useEffect, useState } from "react";
import { getValidDate } from "shared/dates";
import { HoldoutUpdateSchedule } from "shared/validators";
import { Box, Flex, Text } from "@radix-ui/themes";
import DatePicker from "@/components/DatePicker";
import Callout from "@/ui/Callout";

interface Props {
  defaultValue: HoldoutUpdateSchedule;
  onChange: (value: HoldoutUpdateSchedule) => void;
  disabled?: boolean;
}

export default function ScheduleStatusChangeInputs({
  defaultValue,
  onChange,
  disabled,
}: Props) {
  const [schedule, setSchedule] = useState<HoldoutUpdateSchedule>({
    startAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    startAnalysisPeriodAt: new Date(Date.now() + 65 * 24 * 60 * 60 * 1000),
    stopAt: new Date(Date.now() + 95 * 24 * 60 * 60 * 1000),
  });

  //   useEffect(() => {
  //     props.onChange(rules);
  //   }, [props, props.defaultValue, rules]);

  //   function dateIsValid(date: Date) {
  //     return date instanceof Date && !isNaN(date.valueOf());
  //   }

  //   const onChange = (value: Date | undefined, property: string, i: number) => {
  //     if (i === 0) setDate0(value);
  //     if (i === 1) setDate1(value);
  //     if (value && !dateIsValid(value)) return;

  //     const newRules = [...rules];
  //     newRules[i][property] = value ?? null;
  //     setRules(newRules);
  //   };
  const startDate = schedule.startAt;
  const startAnalysisPeriodDate = schedule.startAnalysisPeriodAt;
  const stopDate = schedule.stopAt;

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
            <DatePicker
              date={schedule.startAt}
              setDate={(d) => {
                setSchedule({ ...schedule, startAt: d });
              }}
              disableBefore={new Date()}
              scheduleEndDate={
                schedule.startAnalysisPeriodAt
                  ? getValidDate(schedule.startAnalysisPeriodAt)
                  : undefined
              }
            />
            <span className="pl-2">({formatTimeZone(new Date(), "z")})</span>
          </Flex>
        </Flex>
        <Flex direction="row" align="baseline" gap="4">
          <Text size="2" weight="medium">
            Start analysis period at
          </Text>

          <Flex direction="row" align="center">
            <DatePicker
              date={schedule.startAnalysisPeriodAt}
              setDate={(d) => {
                setSchedule({ ...schedule, startAnalysisPeriodAt: d });
              }}
              disableBefore={new Date()}
              scheduleStartDate={
                schedule.startAt ? getValidDate(schedule.startAt) : undefined
              }
            />
            <span className="pl-2">({formatTimeZone(new Date(), "z")})</span>
          </Flex>
        </Flex>
        <Flex direction="row" align="baseline" gap="4">
          <Text size="2" weight="medium">
            Stop at
          </Text>

          <Flex direction="row" align="center">
            <DatePicker
              date={schedule.stopAt}
              setDate={(d) => {
                setSchedule({ ...schedule, stopAt: d });
              }}
              disableBefore={new Date()}
              scheduleStartDate={
                schedule.startAnalysisPeriodAt
                  ? getValidDate(schedule.startAnalysisPeriodAt)
                  : undefined
              }
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
