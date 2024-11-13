import { DateRange, DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import * as Popover from "@radix-ui/react-popover";
import { format } from "date-fns";
import React from "react";
import { getValidDate } from "shared/dates";
import { Flex } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import styles from "./DatePicker.module.scss";

type Props = {
  date: Date | undefined;
  setDate: (date: Date | undefined) => void;
  date2?: Date | undefined;
  setDate2?: (date: Date | undefined) => void;
  inputWidth?: number | string;
  precision?: "datetime" | "date";
};

export default function DatePicker({
  date,
  setDate,
  date2,
  setDate2,
  inputWidth = 200,
  precision = "datetime",
}: Props) {
  const isRange = !!setDate2;

  const handleDateSelect = (date: Date) => {
    setDate(date);
  };

  const handleDateRangeSelect = (daterange: DateRange) => {
    setDate(daterange?.from);
    setDate2?.(daterange?.to);
  };

  return (
    <Popover.Root>
      <Flex gap="1rem">
        <Popover.Trigger asChild>
          <div
            className="form-control p-0 overflow-hidden"
            style={{ width: inputWidth }}
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
                      date,
                      precision === "datetime"
                        ? "yyyy-MM-dd'T'HH:mm"
                        : "yyyy-MM-dd"
                    )
                  : ""
              }
              onChange={(e) => {
                const d = getValidDate(e?.target?.value, date);
                setDate(d);
              }}
            />
          </div>
        </Popover.Trigger>
        {isRange && (
          <Popover.Trigger asChild>
            <div
              className="form-control p-0 overflow-hidden"
              style={{ width: inputWidth }}
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
                        date2,
                        precision === "datetime"
                          ? "yyyy-MM-dd'T'HH:mm"
                          : "yyyy-MM-dd"
                      )
                    : ""
                }
                onChange={(e) => {
                  const d = getValidDate(e?.target?.value, date2);
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
            />
          ) : (
            <DayPicker
              mode="single"
              selected={date}
              onSelect={handleDateSelect}
            />
          )}
          <Popover.Arrow className={styles.Arrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
