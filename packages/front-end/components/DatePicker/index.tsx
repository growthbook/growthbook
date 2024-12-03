import { DateRange, DayPicker, Matcher } from "react-day-picker";
import "react-day-picker/dist/style.css";
import * as Popover from "@radix-ui/react-popover";
import { format } from "date-fns";
import React, { ReactNode, useRef, useState } from "react";
import { getValidDate } from "shared/dates";
import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import Field from "@/components/Forms/Field";
import styles from "./DatePicker.module.scss";

type Props = {
  id?: string | undefined;
  date: Date | string | undefined;
  setDate: (d: Date | undefined) => void;
  date2?: Date | string | undefined;
  setDate2?: (d: Date | undefined) => void;
  label?: ReactNode;
  label2?: ReactNode;
  helpText?: ReactNode;
  inputWidth?: number;
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
  id,
  date,
  setDate,
  date2,
  setDate2,
  label,
  label2,
  helpText,
  inputWidth,
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

  // todo: update calendar's month when interacting with field and month changes

  const [originalDate, setOriginalDate] = useState(date);
  const [originalDate2, setOriginalDate2] = useState(date2);
  const [calendarMonth, setCalendarMonth] = useState(
    new Date(
      (date ?? new Date()).getUTCFullYear(),
      (date ?? new Date()).getUTCMonth()
    )
  );

  const [open, setOpen] = useState(false);
  const fieldClickedTime = useRef(new Date());

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
        open={open}
        onOpenChange={(o) => {
          if (o) {
            setOpen(true);
          }
          if (!o && +new Date() - +fieldClickedTime.current > 10) {
            setOpen(false);
            setOriginalDate(getValidDate(date));
            setOriginalDate2(getValidDate(date2));
          }
        }}
      >
        <Popover.Trigger asChild>
          <Flex gap="1rem" display={inputWidth ? "inline-flex" : "flex"}>
            <div style={{ width: inputWidth || "100%", minHeight: 38 }}>
              {label ? <label>{label}</label> : null}
              <div
                className="form-control p-0"
                style={{
                  width: inputWidth || "100%",
                  minHeight: 38,
                  overflow: "clip",
                }}
              >
                <Field
                  id={id ?? ""}
                  style={{
                    border: 0,
                    marginRight: -20,
                    width: "calc(100% + 30px)",
                    minHeight: 38,
                    cursor: "pointer",
                  }}
                  className={clsx("date-picker-field", { "text-muted": !date })}
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
                    let d = getValidDate(e?.target?.value, getValidDate(date));
                    if (disableBefore && d < getValidDate(disableBefore)) {
                      d = getValidDate(disableBefore);
                    } else if (disableAfter && d > getValidDate(disableAfter)) {
                      d = getValidDate(disableAfter);
                    }
                    setDate(d);
                    setCalendarMonth(d);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    fieldClickedTime.current = new Date();
                    setOpen(true);
                  }}
                />
              </div>
            </div>
            {isRange && (
              <div style={{ width: inputWidth || "100%", minHeight: 38 }}>
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
                    className={clsx("date-picker-field", {
                      "text-muted": !date2,
                    })}
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
                      let d = getValidDate(
                        e?.target?.value,
                        getValidDate(date2)
                      );
                      if (disableBefore && d < getValidDate(disableBefore)) {
                        d = getValidDate(disableBefore);
                      } else if (
                        disableAfter &&
                        d > getValidDate(disableAfter)
                      ) {
                        d = getValidDate(disableAfter);
                      }
                      setDate2?.(d);
                      setCalendarMonth(d);
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      fieldClickedTime.current = new Date();
                      setOpen(true);
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
                fixedWeeks
                showOutsideDays
                month={calendarMonth}
                onMonthChange={(m) => setCalendarMonth(m)}
              />
            ) : (
              <DayPicker
                mode="single"
                selected={date}
                onSelect={handleDateSelect}
                disabled={disabledMatchers}
                modifiers={markedDays}
                modifiersClassNames={modifiersClassNames}
                fixedWeeks
                showOutsideDays
                month={calendarMonth}
                onMonthChange={(m) => setCalendarMonth(m)}
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
