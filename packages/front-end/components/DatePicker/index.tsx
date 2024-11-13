import { DateRange, DayPicker, Matcher } from "react-day-picker";
import "react-day-picker/dist/style.css";
import * as Popover from "@radix-ui/react-popover";
import { format } from "date-fns";
import React, { useState } from "react";
import { getValidDate } from "shared/dates";
import { Flex } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import styles from "./DatePicker.module.scss";

type Props = {
  date: Date | undefined;
  setDate: (d: Date | undefined) => void;
  date2?: Date | undefined;
  setDate2?: (d: Date | undefined) => void;
  inputWidth?: number | string;
  precision?: "datetime" | "date";
  disableBefore?: Date;
  disableAfter?: Date;
  activeDates?: Date[];
  scheduleStartDate?: Date;
  scheduleEndDate?: Date;
};

const modifiersClassNames = {
  originalDate: "originalDate",
  originalDate2: "originalDate2",
  activeDates: "activeDate",
  scheduleStartDate: "scheduleStartDate",
  scheduleEndDate: "scheduleEndDate",
};

export default function DatePicker({
  date,
  setDate,
  date2,
  setDate2,
  inputWidth = 200,
  precision = "datetime",
  disableBefore,
  disableAfter,
  activeDates,
  scheduleStartDate,
  scheduleEndDate,
}: Props) {
  const [originalDate, setOriginalDate] = useState(date);
  const [originalDate2, setOriginalDate2] = useState(date2);

  const disabledMatchers: Matcher[] = [];
  if (disableBefore) {
    disabledMatchers.push({ before: disableBefore });
  }
  if (disableAfter) {
    disabledMatchers.push({ after: disableAfter });
  }

  const markedDays: Record<string, Matcher | Matcher[] | undefined> = {};
  if (originalDate) {
    markedDays.originalDate = originalDate;
  }
  if (originalDate2) {
    markedDays.originalDate2 = originalDate2;
  }
  if (activeDates?.length) {
    markedDays.activeDates = activeDates;
  }
  if (scheduleStartDate) {
    markedDays.scheduleStartDate = scheduleStartDate;
  }
  if (scheduleEndDate) {
    markedDays.scheduleEndDate = scheduleEndDate;
  }

  const isRange = !!setDate2;

  const handleDateSelect = (date: Date) => {
    setDate(date);
  };

  const handleDateRangeSelect = (daterange: DateRange) => {
    setDate(daterange?.from);
    setDate2?.(daterange?.to);
  };

  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (!open) {
          setOriginalDate(date);
          setOriginalDate2(date2);
        }
      }}
    >
      <Flex gap="1rem">
        <Popover.Trigger asChild>
          <div
            className="form-control p-0"
            style={{ width: inputWidth, overflow: "clip" }}
          >
            <Field
              style={{
                border: 0,
                marginRight: -20,
                width: "calc(100% + 30px)",
                cursor: "pointer",
              }}
              type={precision === "datetime" ? "datetime-local" : "date"}
              value={
                date
                  ? format(
                      getValidDate(date),
                      precision === "datetime"
                        ? "yyyy-MM-dd'T'HH:mm"
                        : "yyyy-MM-dd"
                    )
                  : ""
              }
              onChange={(e) => {
                const d = getValidDate(e?.target?.value, getValidDate(date));
                setDate(d);
              }}
            />
          </div>
        </Popover.Trigger>
        {isRange && (
          <Popover.Trigger asChild>
            <div
              className="form-control p-0"
              style={{ width: inputWidth, overflow: "clip" }}
            >
              <Field
                style={{
                  border: 0,
                  marginRight: -20,
                  width: "calc(100% + 30px)",
                  cursor: "pointer",
                }}
                type={precision === "datetime" ? "datetime-local" : "date"}
                // todo: precision?
                value={
                  date2
                    ? format(
                        getValidDate(date2),
                        precision === "datetime"
                          ? "yyyy-MM-dd'T'HH:mm"
                          : "yyyy-MM-dd"
                      )
                    : ""
                }
                onChange={(e) => {
                  const d = getValidDate(e?.target?.value, getValidDate(date2));
                  setDate2?.(d);
                }}
              />
            </div>
          </Popover.Trigger>
        )}
      </Flex>

      <Popover.Portal>
        <Popover.Content
          className={styles.Content}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {isRange ? (
            <DayPicker
              mode="range"
              selected={{ from: date, to: date2 }}
              onSelect={handleDateRangeSelect}
              disabled={disabledMatchers}
              modifiers={markedDays}
              modifiersClassNames={modifiersClassNames}
            />
          ) : (
            <DayPicker
              mode="single"
              selected={date}
              onSelect={handleDateSelect}
              disabled={disabledMatchers}
              modifiers={markedDays}
              modifiersClassNames={modifiersClassNames}
            />
          )}
          <Popover.Arrow className={styles.Arrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
