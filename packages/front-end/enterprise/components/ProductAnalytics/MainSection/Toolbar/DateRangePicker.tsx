import React from "react";
import { Flex, TextField } from "@radix-ui/themes";
import { dateRangePredefined, lookbackUnit } from "shared/validators";
import { Select, SelectItem } from "@/ui/Select";
import DatePicker from "@/components/DatePicker";
import { useExplorerContext } from "../../ExplorerContext";

const PREDEFINED_LABELS: Record<
  (typeof dateRangePredefined)[number],
  string
> = {
  today: "Today",
  last7Days: "7d",
  last30Days: "30d",
  last90Days: "90d",
  customLookback: "Custom Lookback",
  customDateRange: "Custom Date Range",
};

export default function DateRangePicker() {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();
  const { dateRange } = draftExploreState;

  return (
    <Flex align="center" gap="2">
      <Select
        size="2"
        value={dateRange.predefined}
        placeholder="Select range"
        setValue={(v) => {
          setDraftExploreState((prev) => ({
            ...prev,
            dateRange: {
              ...prev.dateRange,
              predefined: v as (typeof dateRangePredefined)[number],
            },
          }));
        }}
      >
        {dateRangePredefined.map((option) => (
          <SelectItem key={option} value={option}>
            {PREDEFINED_LABELS[option] || option}
          </SelectItem>
        ))}
      </Select>

      {dateRange.predefined === "customLookback" && (
        <>
          <TextField.Root
            size="2"
            type="number"
            min="1"
            placeholder="Value"
            value={dateRange.lookbackValue?.toString() || ""}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              setDraftExploreState((prev) => ({
                ...prev,
                dateRange: {
                  ...prev.dateRange,
                  lookbackValue: isNaN(val) ? null : val,
                },
              }));
            }}
          />
          <Select
            size="2"
            value={dateRange.lookbackUnit || "day"}
            setValue={(v) => {
              setDraftExploreState((prev) => ({
                ...prev,
                dateRange: {
                  ...prev.dateRange,
                  lookbackUnit: v as (typeof lookbackUnit)[number],
                },
              }));
            }}
          >
            {lookbackUnit.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </Select>
        </>
      )}

      {dateRange.predefined === "customDateRange" && (
        <DatePicker
          date={dateRange.startDate || undefined}
          date2={dateRange.endDate || undefined}
          setDate={(d) => {
            setDraftExploreState((prev) => ({
              ...prev,
              dateRange: {
                ...prev.dateRange,
                startDate: d || null,
              },
            }));
          }}
          setDate2={(d) => {
            setDraftExploreState((prev) => ({
              ...prev,
              dateRange: {
                ...prev.dateRange,
                endDate: d || null,
              },
            }));
          }}
          precision="date"
        />
      )}
    </Flex>
  );
}
