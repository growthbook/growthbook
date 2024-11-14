import { DateRange, DayPicker, Matcher } from "react-day-picker";
import "react-day-picker/dist/style.css";
import * as Popover from "@radix-ui/react-popover";
import { format } from "date-fns";
import React, { ReactNode, useState } from "react";
import { getValidDate } from "shared/dates";
import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import Field from "@/components/Forms/Field";
import styles from "./DatePicker.module.scss";

type Props = {
  date: Date | string | undefined;
  setDate: (d: Date | undefined) => void;
  date2?: Date | string | undefined;
  setDate2?: (d: Date | undefined) => void;
  label?: ReactNode;
  label2?: ReactNode;
  helpText?: ReactNode;
  inputWidth?: number | string;
  precision?: "datetime" | "date";
  disableBefore?: Date | string;
  disableAfter?: Date | string;
  activeDates?: (Date | string)[];
  scheduleStartDate?: Date | string;
  scheduleEndDate?: Date | string;
  containerClassName?: string;
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
  label,
  label2,
  helpText,
  inputWidth = "100%",
  precision = "datetime",
  disableBefore,
  disableAfter,
  activeDates,
  scheduleStartDate,
  scheduleEndDate,
  containerClassName = "form-group",
}: Props) {
  if (typeof date === "string") {
    date = date ? getValidDate(date) : undefined;
  }
  if (typeof date2 === "string") {
    date2 = date2 ? getValidDate(date2) : undefined;
  }

  const [originalDate, setOriginalDate] = useState(date);
  const [originalDate2, setOriginalDate2] = useState(date2);

  const disabledMatchers: Matcher[] = [];
  if (disableBefore) {
    disabledMatchers.push({ before: getValidDate(disableBefore) });
  }
  if (disableAfter) {
    disabledMatchers.push({ after: getValidDate(disableAfter) });
  }

  const markedDays: Record<string, Matcher | Matcher[] | undefined> = {};
  if (originalDate) {
    markedDays.originalDate = originalDate;
  }
  if (originalDate2) {
    markedDays.originalDate2 = originalDate2;
  }
  if (activeDates?.length) {
    markedDays.activeDates = activeDates.map((d) => getValidDate(d));
  }
  if (scheduleStartDate) {
    markedDays.scheduleStartDate = getValidDate(scheduleStartDate);
  }
  if (scheduleEndDate) {
    markedDays.scheduleEndDate = getValidDate(scheduleEndDate);
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
    <div className={containerClassName}>
      <Popover.Root
        onOpenChange={(open) => {
          if (!open) {
            setOriginalDate(date);
            setOriginalDate2(date2);
          }
        }}
      >
        <Popover.Trigger asChild>
          <Flex gap="1rem" display="inline-flex">
            <div style={{ width: inputWidth, minHeight: 38 }}>
              {label ? <label>{label}</label> : null}
              <div
                className="form-control p-0"
                style={{ width: inputWidth, minHeight: 38, overflow: "clip" }}
              >
                <Field
                  style={{
                    border: 0,
                    marginRight: -20,
                    width: "calc(100% + 30px)",
                    minHeight: 38,
                    cursor: "pointer",
                  }}
                  className={clsx({ "text-muted": !date })}
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
                    const d = getValidDate(
                      e?.target?.value,
                      getValidDate(date)
                    );
                    setDate(d);
                  }}
                />
              </div>
            </div>
            {isRange && (
              <div style={{ width: inputWidth, minHeight: 38 }}>
                {label2 ? <label>{label2}</label> : null}
                <div
                  className="form-control p-0"
                  style={{ width: inputWidth, minHeight: 38, overflow: "clip" }}
                >
                  <Field
                    style={{
                      border: 0,
                      marginRight: -20,
                      width: "calc(100% + 30px)",
                      minHeight: 38,
                      cursor: "pointer",
                    }}
                    className={clsx({ "text-muted": !date2 })}
                    type={precision === "datetime" ? "datetime-local" : "date"}
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
                      const d = getValidDate(
                        e?.target?.value,
                        getValidDate(date2)
                      );
                      setDate2?.(d);
                    }}
                  />
                </div>
              </div>
            )}
          </Flex>
        </Popover.Trigger>

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
      {helpText && <small className="form-text text-muted">{helpText}</small>}
    </div>
  );
}
