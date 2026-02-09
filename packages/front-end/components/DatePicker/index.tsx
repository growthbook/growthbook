import { DateRange, DayPicker, Matcher } from "react-day-picker";
import "react-day-picker/dist/style.css";
import * as Popover from "@radix-ui/react-popover";
import { format } from "date-fns";
import React, { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { getValidDate } from "shared/dates";
import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import { debounce } from "lodash";
import Field from "@/components/Forms/Field";
import { RadixTheme } from "@/services/RadixTheme";
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
  const dateFormat =
    precision === "datetime" ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd";
  const [bufferedDate, setBufferedDate] = useState(
    date ? format(getValidDate(date), dateFormat) : "",
  );
  const [bufferedDate2, setBufferedDate2] = useState(
    date2 ? format(getValidDate(date2), dateFormat) : "",
  );

  const [calendarMonth, setCalendarMonth] = useState(
    new Date(
      getValidDate(date ?? new Date()).getUTCFullYear(),
      getValidDate(date ?? new Date()).getUTCMonth(),
    ),
  );
  const [open, setOpen] = useState(false);

  // TODO: Check why date is buffered
  // Sync buffered values when parent clears or changes date/date2 (e.g. setDate(undefined))
  useEffect(() => {
    setBufferedDate(date ? format(getValidDate(date), dateFormat) : "");
  }, [date, dateFormat]);
  useEffect(() => {
    setBufferedDate2(date2 ? format(getValidDate(date2), dateFormat) : "");
  }, [date2, dateFormat]);

  const fieldClickedTime = useRef(new Date());

  const disabledMatchers: Matcher[] = [];
  if (disableBefore) {
    disabledMatchers.push({ before: getValidDate(disableBefore) });
  }
  if (disableAfter) {
    disabledMatchers.push({ after: getValidDate(disableAfter) });
  }

  const markedDays: Record<string, Matcher | Matcher[] | undefined> = {};
  if (date) {
    markedDays.originalDate = getValidDate(date);
  }
  if (date2) {
    markedDays.originalDate2 = getValidDate(date2);
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

  const debouncedSetDate = useMemo(() => {
    return debounce((value: string, field: "date" | "date2" = "date") => {
      const parsedDate = getValidDate(value);
      let finalDate = parsedDate;
      if (disableBefore && parsedDate < getValidDate(disableBefore)) {
        finalDate = getValidDate(disableBefore);
      } else if (disableAfter && parsedDate > getValidDate(disableAfter)) {
        finalDate = getValidDate(disableAfter);
      }
      if (field === "date") {
        setDate(finalDate);
        setBufferedDate(format(finalDate, dateFormat));
      } else if (field === "date2") {
        setDate2?.(finalDate);
        setBufferedDate2(format(finalDate, dateFormat));
      }
      setCalendarMonth(
        new Date(finalDate.getUTCFullYear(), finalDate.getUTCMonth()),
      );
    }, 500);
  }, [
    disableBefore,
    disableAfter,
    setDate,
    setBufferedDate,
    setCalendarMonth,
    setDate2,
    setBufferedDate2,
    dateFormat,
  ]);

  return (
    <div className={containerClassName}>
      <Popover.Root
        open={open}
        onOpenChange={(o) => {
          if (o) {
            setOpen(true);
          } else {
            setOpen(false);
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
                  value={bufferedDate}
                  onChange={(e) => {
                    setBufferedDate(e.target.value);
                    debouncedSetDate(e.target.value);
                  }}
                  onBlur={() => debouncedSetDate.flush()} // Ensure immediate validation on blur
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
                    value={bufferedDate2}
                    onChange={(e) => {
                      setBufferedDate2(e.target.value);
                      debouncedSetDate(e.target.value, "date2");
                    }}
                    onBlur={() => debouncedSetDate.flush()} // Ensure immediate validation on blur
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
          <RadixTheme>
            <Popover.Content
              className={styles.Content}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              {isRange ? (
                <DayPicker
                  mode="range"
                  selected={{
                    from: getValidDate(date),
                    to: getValidDate(date2),
                  }}
                  onSelect={(daterange: DateRange) => {
                    if (!daterange) return;
                    setDate(daterange?.from);
                    setDate2?.(daterange?.to);
                    if (daterange?.from)
                      setBufferedDate(format(daterange.from, dateFormat));
                    if (daterange?.to)
                      setBufferedDate2(format(daterange.to, dateFormat));
                  }}
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
                  selected={getValidDate(date)}
                  onSelect={(selectedDate: Date) => {
                    if (!selectedDate) selectedDate = new Date();
                    setDate(selectedDate);
                    setBufferedDate(format(selectedDate, dateFormat));
                  }}
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
          </RadixTheme>
        </Popover.Portal>
      </Popover.Root>
      {helpText && <small className="form-text text-muted">{helpText}</small>}
    </div>
  );
}
