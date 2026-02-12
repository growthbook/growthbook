import React from "react";
import { Flex } from "@radix-ui/themes";
import { dateRangePredefined, lookbackUnit } from "shared/validators";
import { Select, SelectItem } from "@/ui/Select";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";

const PREDEFINED_LABELS: Record<(typeof dateRangePredefined)[number], string> =
  {
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

  const handleCustomLookbackValueChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = e.target.value ? parseInt(e.target.value) : null;
    console.log("value", value);
    if ((value !== null && value < 1) || (value !== null && isNaN(value))) {
      return;
    }
    setDraftExploreState((prev) => ({
      ...prev,
      dateRange: { ...prev.dateRange, lookbackValue: value },
    }));
  };

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
          <Field
            style={{
              width: "55px",
              paddingTop: "0px",
              paddingBottom: "0px",
              height: "32px",
            }}
            placeholder="#"
            min="1"
            value={dateRange.lookbackValue?.toString() || ""}
            onChange={(e) => {
              handleCustomLookbackValueChange(e);
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
                {u}(s)
              </SelectItem>
            ))}
          </Select>
        </>
      )}

      {dateRange.predefined === "customDateRange" && (
        <DatePicker
          containerClassName="mb-0"
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
