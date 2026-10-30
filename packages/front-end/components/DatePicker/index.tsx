import { DateRange, DayPicker, Matcher } from "react-day-picker";
import "react-day-picker/dist/style.css";
import * as Popover from "@radix-ui/react-popover";
import { endOfDay, format, startOfDay, startOfMonth } from "date-fns";
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
import { localAsUtc, utcAsLocal } from "@/utils/date";
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
  size?: "md" | "legacy";
  disabled?: boolean;
  required?: boolean;
  /** Timezone the user picks in, shown beside the field. With "utc", the field shows and edits the UTC date and time. */
  timeZone?: "utc" | "local";
  fixedSpanMode?: {
    phase: "committed" | "choosing";
    anchorDate?: Date;
    candidateRanges?: Array<{ from: Date; to: Date }>;
    onDayPick: (day: Date) => void;
  };
  // Until a date is picked, the field only opens the calendar.
  placeholder?: string;
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

/** Converts between the values callers pass in and what the user sees and types. */
type Clock = {
  /** Caller value → its exact date and time, for clamping to bounds. */
  toDate: (value: Date | string) => Date;
  /** Caller value → the day the calendar shows (the calendar only renders local time). */
  toCalendar: (value: Date | string) => Date;
  /** Calendar day → value handed back to the caller. */
  fromCalendar: (day: Date) => Date;
  toText: (value: Date | string) => string;
  fromText: (text: string) => Date;
};

function localClock(precision: "datetime" | "date"): Clock {
  // `new Date("yyyy-MM-dd")` is UTC midnight, so a date-only string shifts to local midnight; a Date is already local.
  const parse = (value: Date | string) =>
    precision === "datetime" || value instanceof Date
      ? getValidDate(value)
      : getValidDateOffsetByUTC(value);
  const textFormat =
    precision === "datetime" ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd";
  return {
    toDate: parse,
    toCalendar: parse,
    fromCalendar: (day) => day,
    toText: (value) => format(parse(value), textFormat),
    fromText: parse,
  };
}

function utcClock(precision: "datetime" | "date"): Clock {
  const textLength = precision === "datetime" ? 16 : 10;
  return {
    toDate: (value) => getValidDate(value),
    toCalendar: (value) => utcAsLocal(getValidDate(value)),
    fromCalendar: localAsUtc,
    // Text never passes through a local Date, which can't hold a UTC time in the viewer's DST gap.
    toText: (value) => getValidDate(value).toISOString().slice(0, textLength),
    fromText: (text) =>
      getValidDate(precision === "datetime" ? `${text}Z` : text),
  };
}

// Abbreviations can be ambiguous ("IST"), so the full name goes to the tooltip and screen readers.
function zoneLabel(timeZone: Props["timeZone"], at: Date) {
  if (timeZone === "utc") {
    return { abbr: "UTC", name: "Coordinated Universal Time" };
  }
  if (timeZone === "local") {
    return { abbr: formatTimeZone(at, "z"), name: formatTimeZone(at, "zzzz") };
  }
  return null;
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
  error,
  clampInput = true,
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
  size = "legacy",
  disabled,
  required,
  timeZone,
  fixedSpanMode,
  placeholder,
}: Props) {
  const clock = useMemo(
    () => (timeZone === "utc" ? utcClock(precision) : localClock(precision)),
    [timeZone, precision],
  );
  const zone = zoneLabel(timeZone, date ? clock.toDate(date) : new Date());
  const autoId = useId();
  const fieldId = id || autoId;
  const zoneId = `${fieldId}-zone`;

  const fixedHeight = compact || size === "md";
  // Legacy matches the other legacy fields and selects.
  const inputHeight = fixedHeight ? 32 : 36;
  // The field sits inside the bordered box, so it gets the height within it.
  const fieldHeight = inputHeight - 2;
  const compactFieldStyle: React.CSSProperties = compact
    ? {
        boxSizing: "border-box",
        padding: "0 8px",
        lineHeight: 1.25,
      }
    : {};
  const [bufferedDate, setBufferedDate] = useState(
    date ? clock.toText(date) : "",
  );
  const [bufferedDate2, setBufferedDate2] = useState(
    date2 ? clock.toText(date2) : "",
  );

  const [calendarMonth, setCalendarMonth] = useState(() =>
    startOfMonth(date ? clock.toCalendar(date) : new Date()),
  );
  const [open, setOpen] = useState(false);
  const [fieldFocused, setFieldFocused] = useState(false);
  const fieldClickedTime = useRef(new Date());

  useEffect(() => {
    setBufferedDate(date ? clock.toText(date) : "");
    setBufferedDate2(date2 ? clock.toText(date2) : "");
  }, [date, date2, clock]);

  const disabledMatchers: Matcher[] = [];
  if (disableBefore) {
    disabledMatchers.push({ before: clock.toCalendar(disableBefore) });
  }
  if (disableAfter) {
    disabledMatchers.push({ after: clock.toCalendar(disableAfter) });
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
    markedDays.originalDate = clock.toCalendar(date);
  }
  if (date2) {
    markedDays.originalDate2 = clock.toCalendar(date2);
  }
  if (activeDates?.length) {
    markedDays.activeDates = activeDates.map((d) => clock.toCalendar(d));
  }
  if (scheduleStartDate) {
    markedDays.scheduleStartDate = clock.toCalendar(scheduleStartDate);
  }
  if (scheduleEndDate) {
    markedDays.scheduleEndDate = clock.toCalendar(scheduleEndDate);
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
  // A native date field can't show placeholder text, so it's plain text until
  // set, and native again while focused so it can be typed into.
  const showsPlaceholder = !!placeholder && !isRange && !date && !fieldFocused;
  const fieldLabel = isRange ? (label ?? label2) : label;

  const rangeFieldValue = useMemo(() => {
    if (isRange && precision === "date" && !fieldFocused && date && date2) {
      return formatCompactDateRange(
        clock.toCalendar(date),
        clock.toCalendar(date2),
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
    clock,
    precision,
    fieldFocused,
  ]);

  const clampParsedDate = useCallback(
    (parsedDate: Date) => {
      let finalDate = parsedDate;
      if (disableBefore && parsedDate < clock.toDate(disableBefore)) {
        finalDate = clock.toDate(disableBefore);
      } else if (disableAfter && parsedDate > clock.toDate(disableAfter)) {
        finalDate = clock.toDate(disableAfter);
      }
      return finalDate;
    },
    [disableBefore, disableAfter, clock],
  );

  const debouncedSetDate = useMemo(() => {
    return debounce((value: string) => {
      if (!value.trim()) {
        setDate(undefined);
        setBufferedDate("");
        return;
      }
      const parsedDate = clock.fromText(value);
      const finalDate = clampInput ? clampParsedDate(parsedDate) : parsedDate;
      setDate(finalDate);
      setBufferedDate(clock.toText(finalDate));
      setCalendarMonth(startOfMonth(clock.toCalendar(finalDate)));
    }, 500);
  }, [clampInput, clampParsedDate, setDate, setCalendarMonth, clock]);

  const debouncedApplyRange = useMemo(() => {
    return debounce((startStr: string, endStr: string) => {
      const startTrim = startStr.trim();
      const endTrim = endStr.trim();
      let anchor = date ? clock.toDate(date) : new Date();

      if (startTrim) {
        const parsedDate = clock.fromText(startTrim);
        const finalDate = clampParsedDate(parsedDate);
        setDate(finalDate);
        setBufferedDate(clock.toText(finalDate));
        anchor = finalDate;
      } else {
        setDate(undefined);
        setBufferedDate("");
      }

      if (endTrim) {
        const parsedDate2 = clock.fromText(endTrim);
        const finalDate2 = clampParsedDate(parsedDate2);
        setDate2?.(finalDate2);
        setBufferedDate2(clock.toText(finalDate2));
        anchor = finalDate2;
      } else {
        setDate2?.(undefined);
        setBufferedDate2("");
      }

      setCalendarMonth(startOfMonth(clock.toCalendar(anchor)));
    }, 500);
  }, [clampParsedDate, date, clock, setCalendarMonth, setDate, setDate2]);

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
                minHeight: inputHeight,
                flex: wrapRangeInputs && isRange ? "1 1 220px" : undefined,
              }}
            >
              {fieldLabel ? (
                <Text as="label" htmlFor={fieldId} weight="semibold">
                  {fieldLabel}
                  {zone ? <span title={zone.name}> ({zone.abbr})</span> : null}
                </Text>
              ) : null}
              {zone ? (
                <VisuallyHidden id={zoneId}>{zone.name}</VisuallyHidden>
              ) : null}
              <Flex align="center" gap="2">
                <div
                  className={clsx("form-control p-0", styles.field, {
                    [styles.open]: open,
                    "form-control--error": !!error,
                  })}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: fixedHeight ? inputHeight : undefined,
                    minHeight: inputHeight,
                    borderRadius: size === "md" ? "var(--radius-2)" : undefined,
                    overflow: "clip",
                  }}
                >
                  <Field
                    id={fieldId}
                    aria-describedby={zone ? zoneId : undefined}
                    size={size}
                    disabled={disabled}
                    required={required}
                    readOnly={!!fixedSpanMode}
                    autoComplete="off"
                    style={{
                      border: 0,
                      marginRight: -20,
                      width: "calc(100% + 30px)",
                      height: fieldHeight,
                      minHeight: fieldHeight,
                      cursor: "pointer",
                      ...compactFieldStyle,
                    }}
                    className={clsx("date-picker-field", {
                      "text-muted": isRange ? !date || !date2 : !date,
                    })}
                    type={
                      isRange || showsPlaceholder
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
                        : showsPlaceholder
                          ? placeholder
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
                      setFieldFocused(true);
                      if (isRange && date && date2) {
                        setBufferedDate(clock.toText(date));
                        setBufferedDate2(clock.toText(date2));
                      }
                    }}
                    onBlur={() => {
                      setFieldFocused(false);
                      debouncedSetDate.flush();
                      debouncedApplyRange.flush();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      if (disabled) return;
                      fieldClickedTime.current = new Date();
                      setOpen(true);
                    }}
                  />
                </div>
                {/* Without a label to suffix, the zone sits after the field. */}
                {zone && !fieldLabel ? (
                  <Text whiteSpace="nowrap" title={zone.name}>
                    ({zone.abbr})
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
                          from: clock.toCalendar(date),
                          to: clock.toCalendar(date2),
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
                          from: clock.toCalendar(date),
                          to: date2 ? clock.toCalendar(date2) : undefined,
                        }
                      : undefined
                  }
                  onSelect={(daterange: DateRange | undefined) => {
                    if (!daterange) return;
                    const from =
                      daterange.from && clock.fromCalendar(daterange.from);
                    const to = daterange.to && clock.fromCalendar(daterange.to);
                    setDate(from);
                    setDate2?.(to);
                    setBufferedDate(from ? clock.toText(from) : "");
                    setBufferedDate2(to ? clock.toText(to) : "");
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
                  selected={date ? clock.toCalendar(date) : undefined}
                  onSelect={(day: Date) => {
                    const selectedDate = clock.fromCalendar(day);
                    setDate(selectedDate);
                    setBufferedDate(clock.toText(selectedDate));
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
