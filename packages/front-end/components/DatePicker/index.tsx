import { DateRange, DayPicker, Matcher } from "react-day-picker";
import "react-day-picker/dist/style.css";
import * as Popover from "@radix-ui/react-popover";
import { endOfDay, format, startOfDay } from "date-fns";
import { format as formatTimeZone } from "date-fns-tz";
import React, {
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { getValidDate, getValidDateOffsetByUTC } from "shared/dates";
import { Flex, VisuallyHidden } from "@radix-ui/themes";
import clsx from "clsx";
import { debounce } from "lodash";
import Field from "@/components/Forms/Field";
import { RadixTheme } from "@/services/RadixTheme";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import { pickerDateToUtcInstant, utcInstantToPickerDate } from "@/utils/date";
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
  /** Invalid-state message, shown in place of `helpText`. */
  error?: ReactNode;
  /**
   * Snap a typed date onto the nearest bound. Off lets an out-of-range date
   * through so the caller can flag it rather than silently rewriting it.
   */
  clampInput?: boolean;
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
  /**
   * Clock the user picks on, shown beside the field. "utc" takes and returns
   * true instants while editing their UTC wall-clock.
   */
  timeZone?: "utc" | "local";
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
  date: dateProp,
  setDate,
  date2: date2Prop,
  setDate2,
  label,
  label2,
  helpText,
  error,
  clampInput = true,
  inputWidth,
  precision = "datetime",
  disableBefore: disableBeforeProp,
  disableAfter: disableAfterProp,
  activeDates: activeDatesProp,
  scheduleStartDate: scheduleStartDateProp,
  scheduleEndDate: scheduleEndDateProp,
  containerClassName = "form-group",
  clearButton = false,
  wrapRangeInputs = false,
  compact = false,
  disabled,
  timeZone,
  fixedSpanMode,
}: Props) {
  // Calendar days use the picker's local frame; the text field and clamping use true instants.
  const isUtc = timeZone === "utc";
  const toPicker = useCallback(
    (v: Date | string | undefined) =>
      v && isUtc ? utcInstantToPickerDate(getValidDate(v)) : v,
    [isUtc],
  );
  const date = toPicker(dateProp);
  const date2 = toPicker(date2Prop);
  const disableBefore = toPicker(disableBeforeProp);
  const disableAfter = toPicker(disableAfterProp);
  const scheduleStartDate = toPicker(scheduleStartDateProp);
  const scheduleEndDate = toPicker(scheduleEndDateProp);
  const activeDates = activeDatesProp?.map((d) => toPicker(d) ?? d);
  const fromCalendar = (d: Date) => (isUtc ? pickerDateToUtcInstant(d) : d);
  const zoneDate = date ? getValidDate(date) : new Date();
  const zone = isUtc
    ? "UTC"
    : timeZone === "local"
      ? formatTimeZone(zoneDate, "z")
      : null;
  // Short abbreviations can be ambiguous ("IST"), so the long name goes to the tooltip and screen readers.
  const zoneName = isUtc
    ? "Coordinated Universal Time"
    : zone
      ? formatTimeZone(zoneDate, "zzzz")
      : null;
  const autoId = useId();
  const fieldId = id || autoId;
  const zoneId = `${fieldId}-zone`;

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
  // For `date` precision, `new Date("yyyy-MM-dd")` lands on UTC midnight, so we
  // shift to local midnight via `getValidDateOffsetByUTC`. For `datetime`,
  // `new Date("yyyy-MM-ddTHH:mm")` already parses as local time.
  //
  // Only a *string* needs that shift — it's undoing a parse rule, not converting
  // a timezone. A `Date` already carries the intended day in its local fields
  // (most `date`-precision callers hand us `getValidDateOffsetByUTC(...)`
  // directly), so shifting it again moved it off that day. This must stay
  // idempotent for a `Date`: it's applied to the same value on paths that render
  // the text field and on paths that select the calendar day, and when the two
  // disagreed the field read a day earlier than the calendar highlighted for
  // every user east of UTC.
  const parseDateInput = useCallback(
    (value: Date | string): Date =>
      precision === "datetime" || value instanceof Date
        ? getValidDate(value)
        : getValidDateOffsetByUTC(value),
    [precision],
  );
  const toInstant = useCallback(
    (value: Date | string): Date =>
      isUtc ? getValidDate(value) : parseDateInput(value),
    [isUtc, parseDateInput],
  );
  const formatField = useCallback(
    (value: Date | string): string =>
      isUtc
        ? getValidDate(value)
            .toISOString()
            .slice(0, precision === "datetime" ? 16 : 10)
        : format(parseDateInput(value), dateFormat),
    [isUtc, precision, dateFormat, parseDateInput],
  );
  // A typed UTC wall-clock is read as UTC directly, never via a local Date that can't hold DST-gap times.
  const parseField = useCallback(
    (value: string): Date =>
      isUtc
        ? getValidDate(precision === "datetime" ? `${value}Z` : value)
        : parseDateInput(value),
    [isUtc, precision, parseDateInput],
  );
  const calendarMonthOf = useCallback(
    (instant: Date) => {
      const d = isUtc ? utcInstantToPickerDate(instant) : instant;
      return new Date(d.getFullYear(), d.getMonth());
    },
    [isUtc],
  );
  const [bufferedDate, setBufferedDate] = useState(
    dateProp ? formatField(dateProp) : "",
  );
  const [bufferedDate2, setBufferedDate2] = useState(
    date2Prop ? formatField(date2Prop) : "",
  );

  const [calendarMonth, setCalendarMonth] = useState(() => {
    const anchor = date ? parseDateInput(date) : new Date();
    return new Date(anchor.getFullYear(), anchor.getMonth());
  });
  const [open, setOpen] = useState(false);
  const [rangeFieldFocused, setRangeFieldFocused] = useState(false);
  const fieldClickedTime = useRef(new Date());

  useEffect(() => {
    setBufferedDate(dateProp ? formatField(dateProp) : "");
    setBufferedDate2(date2Prop ? formatField(date2Prop) : "");
  }, [dateProp, date2Prop, formatField]);

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
  // Markers land on calendar days, so they go through `parseDateInput` for the
  // same reason `selected` does — a `yyyy-MM-dd` string would otherwise mark the
  // previous day for anyone west of UTC.
  if (date) {
    markedDays.originalDate = parseDateInput(date);
  }
  if (date2) {
    markedDays.originalDate2 = parseDateInput(date2);
  }
  if (activeDates?.length) {
    markedDays.activeDates = activeDates.map((d) => parseDateInput(d));
  }
  if (scheduleStartDate) {
    markedDays.scheduleStartDate = parseDateInput(scheduleStartDate);
  }
  if (scheduleEndDate) {
    markedDays.scheduleEndDate = parseDateInput(scheduleEndDate);
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
  const fieldLabel = isRange ? (label ?? label2) : label;
  // Without a label to suffix, the zone sits inline after the field.
  const inlineZone = fieldLabel ? null : zone;

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
      if (disableBeforeProp && parsedDate < toInstant(disableBeforeProp)) {
        finalDate = toInstant(disableBeforeProp);
      } else if (disableAfterProp && parsedDate > toInstant(disableAfterProp)) {
        finalDate = toInstant(disableAfterProp);
      }
      return finalDate;
    },
    [disableBeforeProp, disableAfterProp, toInstant],
  );

  const debouncedSetDate = useMemo(() => {
    return debounce((value: string) => {
      const parsedDate = parseField(value);
      const finalDate = clampInput ? clampParsedDate(parsedDate) : parsedDate;
      setDate(finalDate);
      setBufferedDate(formatField(finalDate));
      setCalendarMonth(calendarMonthOf(finalDate));
    }, 500);
  }, [
    clampInput,
    clampParsedDate,
    setDate,
    setCalendarMonth,
    formatField,
    parseField,
    calendarMonthOf,
  ]);

  const debouncedApplyRange = useMemo(() => {
    return debounce((startStr: string, endStr: string) => {
      const startTrim = startStr.trim();
      const endTrim = endStr.trim();
      let anchor = dateProp ? toInstant(dateProp) : new Date();

      if (startTrim) {
        const parsedDate = parseField(startTrim);
        const finalDate = clampParsedDate(parsedDate);
        setDate(finalDate);
        setBufferedDate(formatField(finalDate));
        anchor = finalDate;
      } else {
        setDate(undefined);
        setBufferedDate("");
      }

      if (endTrim) {
        const parsedDate2 = parseField(endTrim);
        const finalDate2 = clampParsedDate(parsedDate2);
        setDate2?.(finalDate2);
        setBufferedDate2(formatField(finalDate2));
        anchor = finalDate2;
      } else {
        setDate2?.(undefined);
        setBufferedDate2("");
      }

      setCalendarMonth(calendarMonthOf(anchor));
    }, 500);
  }, [
    clampParsedDate,
    dateProp,
    toInstant,
    formatField,
    parseField,
    calendarMonthOf,
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
              {fieldLabel ? (
                <Text as="label" htmlFor={fieldId} weight="semibold">
                  {fieldLabel}
                  {zone ? (
                    <span title={zoneName ?? undefined}> ({zone})</span>
                  ) : null}
                </Text>
              ) : null}
              {zoneName ? (
                <VisuallyHidden id={zoneId}>{zoneName}</VisuallyHidden>
              ) : null}
              <Flex align="center" gap="2">
                <div
                  className={clsx("form-control p-0", {
                    "form-control--error": !!error,
                  })}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: compact ? inputHeight : undefined,
                    minHeight: inputHeight,
                    overflow: "clip",
                  }}
                >
                  <Field
                    id={fieldId}
                    aria-describedby={zoneName ? zoneId : undefined}
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
                      if (dateProp && date2Prop) {
                        setBufferedDate(formatField(dateProp));
                        setBufferedDate2(formatField(date2Prop));
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
                {inlineZone ? (
                  <Text whiteSpace="nowrap" title={zoneName ?? undefined}>
                    ({inlineZone})
                  </Text>
                ) : null}
                {/* TODO: Support clearing date ranges as well. Clear button is meant to be a stop gap until we can add a clear button within the field itself */}
                {clearButton && !isRange && (
                  <Button
                    color="red"
                    disabled={disabled || !bufferedDate}
                    variant="ghost"
                    size="md"
                    onClick={() => {
                      setBufferedDate("");
                      setDate(undefined);
                    }}
                  >
                    Clear
                  </Button>
                )}
              </Flex>
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
                    // back to an open-ended range rather than the parser's
                    // "today" default so the calendar doesn't highlight
                    // start→today. Nothing selected when there is no start yet.
                    date
                      ? {
                          from: parseDateInput(date),
                          to: date2 ? parseDateInput(date2) : undefined,
                        }
                      : undefined
                  }
                  onSelect={(daterange: DateRange | undefined) => {
                    if (!daterange) return;
                    const from = daterange.from && fromCalendar(daterange.from);
                    const to = daterange.to && fromCalendar(daterange.to);
                    setDate(from);
                    setDate2?.(to);
                    setBufferedDate(from ? formatField(from) : "");
                    setBufferedDate2(to ? formatField(to) : "");
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
                  // Re-clicking the selected day keeps it; the library's default
                  // toggle deselected it, which used to fall back to "now".
                  required
                  // Nothing is selected when there is no date, rather than
                  // `getValidDate`'s "today" fallback highlighting a day the
                  // caller never set (the range branch above already does this).
                  selected={date ? parseDateInput(date) : undefined}
                  onSelect={(day: Date) => {
                    const selectedDate = fromCalendar(day);
                    setDate(selectedDate);
                    setBufferedDate(formatField(selectedDate));
                    // A day is the whole choice at date precision; datetime
                    // still needs the time typed into the field.
                    if (precision === "date") setOpen(false);
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
      {error ? (
        <HelperText status="error" mt="1">
          {error}
        </HelperText>
      ) : helpText ? (
        <small className="form-text text-muted">{helpText}</small>
      ) : null}
    </div>
  );
}
