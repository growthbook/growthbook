import { DateRange, DayPicker, Matcher } from "react-day-picker";
import "react-day-picker/dist/style.css";
import * as Popover from "@radix-ui/react-popover";
import { endOfDay, format, startOfDay } from "date-fns";
import React, {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getValidDate, getValidDateOffsetByUTC } from "shared/dates";
import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import { debounce } from "lodash";
import Field from "@/components/Forms/Field";
import { RadixTheme } from "@/services/RadixTheme";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import styles from "./DatePicker.module.scss";

type Props = {
  id?: string | undefined;
  date: Date | string | undefined;
  setDate: (d: Date | undefined) => void;
  date2?: Date | string | undefined;
  setDate2?: (d: Date | undefined) => void;
  label?: ReactNode;
  /** When using a range (`setDate2`), shown if `label` is omitted. */
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
  clearButton?: boolean;
  wrapRangeInputs?: boolean;
  compact?: boolean;
  disabled?: boolean;
  fixedSpanMode?: {
    phase: "committed" | "choosing";
    anchorDate?: Date;
    candidateRanges?: Array<{ from: Date; to: Date }>;
    onDayPick: (day: Date) => void;
  };
};

const modifiersClassNames = {
  originalDate: "originalDate",
  originalDate2: "originalDate2",
  activeDates: "activeDate",
  scheduleStartDate: "scheduleStartDate",
  scheduleEndDate: "scheduleEndDate",
  candidateBefore: "candidateBefore",
  candidateAfter: "candidateAfter",
  comparisonAnchor: "comparisonAnchor",
};

function isDayWithinInclusiveRange(day: Date, from: Date, to: Date): boolean {
  const t = day.getTime();
  return t >= startOfDay(from).getTime() && t <= endOfDay(to).getTime();
}

/** Separator between start and end in the range text field (space-hyphen-space). */
const RANGE_DISPLAY_SEP = " - ";

function splitRangeFieldInput(value: string): [string, string] {
  const i = value.indexOf(RANGE_DISPLAY_SEP);
  if (i === -1) return [value, ""];
  return [value.slice(0, i), value.slice(i + RANGE_DISPLAY_SEP.length)];
}

export function formatCompactDateRange(startDate: Date, endDate: Date): string {
  const sy = startDate.getFullYear();
  const sm = startDate.getMonth();
  const sd = startDate.getDate();
  const ey = endDate.getFullYear();
  const em = endDate.getMonth();
  const ed = endDate.getDate();

  if (sy === ey && sm === em && sd === ed) {
    return format(startDate, "MMMM d, yyyy");
  }
  if (sy === ey && sm === em) {
    return `${format(startDate, "MMMM d")}-${format(endDate, "d")}, ${ey}`;
  }
  if (sy === ey) {
    return `${format(startDate, "MMMM d")} - ${format(endDate, "MMMM d")}, ${ey}`;
  }
  return `${format(startDate, "MMMM d, yyyy")} - ${format(endDate, "MMMM d, yyyy")}`;
}

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
  clearButton = false,
  wrapRangeInputs = false,
  compact = false,
  disabled,
  fixedSpanMode,
}: Props) {
  const inputHeight = compact ? 32 : 38;
  const compactFieldStyle: React.CSSProperties = compact
    ? {
        height: 32,
        minHeight: 32,
        boxSizing: "border-box",
        padding: "0 8px",
        lineHeight: 1.25,
      }
    : {};
  const dateFormat =
    precision === "datetime" ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd";
  // Parses a date prop / bound in the same frame as the user's typed input.
  // For `date` precision, `new Date("yyyy-MM-dd")` lands on UTC midnight, so
  // we shift to local midnight via `getValidDateOffsetByUTC`. For `datetime`,
  // `new Date("yyyy-MM-ddTHH:mm")` already parses as local time.
  const parseDateInput = useCallback(
    (value: Date | string): Date =>
      precision === "datetime"
        ? getValidDate(value)
        : getValidDateOffsetByUTC(value),
    [precision],
  );
  const [bufferedDate, setBufferedDate] = useState(
    date ? format(getValidDate(date), dateFormat) : "",
  );
  const [bufferedDate2, setBufferedDate2] = useState(
    date2 ? format(getValidDate(date2), dateFormat) : "",
  );

  const [calendarMonth, setCalendarMonth] = useState(
    new Date(
      getValidDate(date ?? new Date()).getFullYear(),
      getValidDate(date ?? new Date()).getMonth(),
    ),
  );
  const [open, setOpen] = useState(false);
  const [rangeFieldFocused, setRangeFieldFocused] = useState(false);
  const fieldClickedTime = useRef(new Date());

  useEffect(() => {
    if (date) {
      setBufferedDate(format(parseDateInput(date), dateFormat));
    } else {
      setBufferedDate("");
    }
    if (date2) {
      setBufferedDate2(format(parseDateInput(date2), dateFormat));
    } else {
      setBufferedDate2("");
    }
  }, [date, date2, dateFormat, parseDateInput]);

  const disabledMatchers: Matcher[] = [];
  if (disableBefore) {
    disabledMatchers.push({ before: parseDateInput(disableBefore) });
  }
  if (disableAfter) {
    disabledMatchers.push({ after: parseDateInput(disableAfter) });
  }

  if (
    fixedSpanMode?.phase === "choosing" &&
    fixedSpanMode.candidateRanges?.length
  ) {
    const candidates = fixedSpanMode.candidateRanges;
    disabledMatchers.push((day) => {
      return !candidates.some((range) =>
        isDayWithinInclusiveRange(day, range.from, range.to),
      );
    });
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

  if (fixedSpanMode?.phase === "choosing" && fixedSpanMode.candidateRanges) {
    const [beforeRange, afterRange] = fixedSpanMode.candidateRanges;
    if (beforeRange) {
      markedDays.candidateBefore = {
        from: beforeRange.from,
        to: beforeRange.to,
      };
    }
    if (afterRange) {
      markedDays.candidateAfter = {
        from: afterRange.from,
        to: afterRange.to,
      };
    }
    if (fixedSpanMode.anchorDate) {
      markedDays.comparisonAnchor = fixedSpanMode.anchorDate;
    }
  }

  const isRange = !!setDate2 || !!fixedSpanMode;

  const rangeFieldValue = useMemo(() => {
    if (
      isRange &&
      precision === "date" &&
      !rangeFieldFocused &&
      date &&
      date2
    ) {
      return formatCompactDateRange(
        parseDateInput(date),
        parseDateInput(date2),
      );
    }
    const a = bufferedDate;
    const b = bufferedDate2;
    if (!a && !b) return "";
    if (a && b) return `${a}${RANGE_DISPLAY_SEP}${b}`;
    return a || b;
  }, [
    bufferedDate,
    bufferedDate2,
    date,
    date2,
    isRange,
    parseDateInput,
    precision,
    rangeFieldFocused,
  ]);

  const clampParsedDate = useCallback(
    (parsedDate: Date) => {
      let finalDate = parsedDate;
      if (disableBefore && parsedDate < parseDateInput(disableBefore)) {
        finalDate = parseDateInput(disableBefore);
      } else if (disableAfter && parsedDate > parseDateInput(disableAfter)) {
        finalDate = parseDateInput(disableAfter);
      }
      return finalDate;
    },
    [disableBefore, disableAfter, parseDateInput],
  );

  const debouncedSetDate = useMemo(() => {
    return debounce((value: string) => {
      const parsedDate = parseDateInput(value);
      const finalDate = clampParsedDate(parsedDate);
      setDate(finalDate);
      setBufferedDate(format(finalDate, dateFormat));
      setCalendarMonth(new Date(finalDate.getFullYear(), finalDate.getMonth()));
    }, 500);
  }, [clampParsedDate, setDate, setCalendarMonth, dateFormat, parseDateInput]);

  const debouncedApplyRange = useMemo(() => {
    return debounce((startStr: string, endStr: string) => {
      const startTrim = startStr.trim();
      const endTrim = endStr.trim();
      let anchor = getValidDate(date ?? new Date());

      if (startTrim) {
        const parsedDate = parseDateInput(startTrim);
        const finalDate = clampParsedDate(parsedDate);
        setDate(finalDate);
        setBufferedDate(format(finalDate, dateFormat));
        anchor = finalDate;
      } else {
        setDate(undefined);
        setBufferedDate("");
      }

      if (endTrim) {
        const parsedDate2 = parseDateInput(endTrim);
        const finalDate2 = clampParsedDate(parsedDate2);
        setDate2?.(finalDate2);
        setBufferedDate2(format(finalDate2, dateFormat));
        anchor = finalDate2;
      } else {
        setDate2?.(undefined);
        setBufferedDate2("");
      }

      setCalendarMonth(new Date(anchor.getFullYear(), anchor.getMonth()));
    }, 500);
  }, [
    clampParsedDate,
    date,
    dateFormat,
    parseDateInput,
    setCalendarMonth,
    setDate,
    setDate2,
  ]);

  return (
    <div className={clsx(containerClassName, { "mb-0": !label && !label2 })}>
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
          <Flex
            gap="1rem"
            display={inputWidth ? "inline-flex" : "flex"}
            wrap={wrapRangeInputs && isRange ? "wrap" : undefined}
            style={
              wrapRangeInputs && isRange
                ? { width: "100%", minWidth: 0 }
                : undefined
            }
          >
            <div
              style={{
                width:
                  inputWidth ||
                  (wrapRangeInputs && isRange ? undefined : "100%"),
                minWidth: isRange ? 220 : undefined,
                height: compact ? inputHeight : undefined,
                minHeight: inputHeight,
                flex: wrapRangeInputs && isRange ? "1 1 220px" : undefined,
              }}
            >
              {(isRange ? (label ?? label2) : label) ? (
                <Text as="label" weight="semibold">
                  {isRange ? (label ?? label2) : label}
                </Text>
              ) : null}
              <div
                style={
                  clearButton && !isRange
                    ? {
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }
                    : {}
                }
              >
                <div
                  className="form-control p-0"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: compact ? inputHeight : undefined,
                    minHeight: inputHeight,
                    overflow: "clip",
                  }}
                >
                  <Field
                    id={id ?? ""}
                    disabled={disabled}
                    readOnly={!!fixedSpanMode}
                    style={{
                      border: 0,
                      marginRight: -20,
                      width: "calc(100% + 30px)",
                      minHeight: inputHeight,
                      cursor: "pointer",
                      ...compactFieldStyle,
                    }}
                    className={clsx("date-picker-field", {
                      "text-muted": isRange ? !date || !date2 : !date,
                    })}
                    type={
                      isRange
                        ? "text"
                        : precision === "datetime"
                          ? "datetime-local"
                          : "date"
                    }
                    placeholder={
                      isRange
                        ? precision === "datetime"
                          ? `yyyy-MM-dd'T'HH:mm${RANGE_DISPLAY_SEP}yyyy-MM-dd'T'HH:mm`
                          : `yyyy-MM-dd${RANGE_DISPLAY_SEP}yyyy-MM-dd`
                        : undefined
                    }
                    value={isRange ? rangeFieldValue : bufferedDate}
                    onChange={(e) => {
                      if (fixedSpanMode) return;
                      if (isRange) {
                        const v = e.target.value;
                        const [startPart, endPart] = splitRangeFieldInput(v);
                        setBufferedDate(startPart);
                        setBufferedDate2(endPart);
                        debouncedApplyRange(startPart, endPart);
                      } else {
                        setBufferedDate(e.target.value);
                        debouncedSetDate(e.target.value);
                      }
                    }}
                    onFocus={() => {
                      if (!isRange) return;
                      setRangeFieldFocused(true);
                      if (date && date2) {
                        setBufferedDate(
                          format(parseDateInput(date), dateFormat),
                        );
                        setBufferedDate2(
                          format(parseDateInput(date2), dateFormat),
                        );
                      }
                    }}
                    onBlur={() => {
                      debouncedSetDate.flush();
                      debouncedApplyRange.flush();
                      if (isRange) {
                        setRangeFieldFocused(false);
                      }
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      if (disabled) return;
                      fieldClickedTime.current = new Date();
                      setOpen(true);
                    }}
                  />
                </div>
                {/* TODO: Support clearing date ranges as well. Clear button is meant to be a stop gap until we can add a clear button within the field itself */}
                {clearButton && !isRange && (
                  <Button
                    color="red"
                    disabled={disabled || !bufferedDate}
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setBufferedDate("");
                      setDate(undefined);
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </Flex>
        </Popover.Trigger>

        <Popover.Portal>
          <RadixTheme>
            <Popover.Content
              className={styles.Content}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              {fixedSpanMode ? (
                <DayPicker
                  mode="range"
                  selected={
                    fixedSpanMode.phase === "committed" && date && date2
                      ? {
                          from: parseDateInput(date),
                          to: parseDateInput(date2),
                        }
                      : undefined
                  }
                  onDayClick={(day) => {
                    fixedSpanMode.onDayPick(day);
                  }}
                  disabled={disabledMatchers}
                  modifiers={markedDays}
                  modifiersClassNames={modifiersClassNames}
                  fixedWeeks
                  showOutsideDays
                  month={calendarMonth}
                  onMonthChange={(m) => setCalendarMonth(m)}
                />
              ) : isRange ? (
                <DayPicker
                  mode="range"
                  selected={
                    // While a range is mid-selection only `date` is set; fall
                    // back to an open-ended range rather than getValidDate's
                    // "today" default so the calendar doesn't highlight
                    // start→today. Nothing selected when there is no start yet.
                    date
                      ? {
                          from: getValidDate(date),
                          to: date2 ? getValidDate(date2) : undefined,
                        }
                      : undefined
                  }
                  onSelect={(daterange: DateRange | undefined) => {
                    if (!daterange) return;
                    const from = daterange.from;
                    const to = daterange.to;
                    setDate(from);
                    setDate2?.(to);
                    if (from) {
                      setBufferedDate(format(from, dateFormat));
                    } else {
                      setBufferedDate("");
                    }
                    if (to) {
                      setBufferedDate2(format(to, dateFormat));
                    } else {
                      setBufferedDate2("");
                    }
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
                    // Picking a day resets the time to 00:00:00 (the calendar
                    // has no time controls). Users can still type a specific
                    // hh:mm:ss into the field afterwards.
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
