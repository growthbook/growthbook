import React, { useState } from "react";
import { Flex, TextField } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "shared/enterprise";
import { Select, SelectItem } from "@/ui/Select";
import { useExplorerContext } from "../../ExplorerContext";


export default function DateRangePicker() {
  const { draftExploreState, submittedExploreState, exploreData, loading, hasPendingChanges, setDraftExploreState } = useExplorerContext();
  const presetDays = [7, 14, 30, 90, 180, 365];

  const [isCustomLookback, setIsCustomLookback] = useState(() => {
    return !presetDays.includes(draftExploreState.lookbackDays);
  });

  const [customDaysInput, setCustomDaysInput] = useState(() => {
    return !presetDays.includes(draftExploreState.lookbackDays)
      ? draftExploreState.lookbackDays.toString()
      : "";
  });

  return (
    <Flex align="center" gap="2">
      <Select
        size="2"
        value={
          isCustomLookback ? "-1" : draftExploreState.lookbackDays + ""
        }
        placeholder="Select value"
        setValue={(v) => {
          const days = parseInt(v);

          if (days === -1) {
            setIsCustomLookback(true);
            setCustomDaysInput("60");
            const start = new Date();
            const end = new Date();
            start.setDate(end.getDate() - 60);

            setDraftExploreState((prev) => ({
              ...prev,
              lookbackDays: 60,
              startDate: start,
              endDate: end,
            }));
          } else {
            setIsCustomLookback(false);
            const start = new Date();
            const end = new Date();
            start.setDate(end.getDate() - days);

            setDraftExploreState((prev) => ({
              ...prev,
              lookbackDays: days,
              startDate: start,
              endDate: end,
            }));
          }
        }}
        containerClassName="mb-0"
      >
        {presetDays.map((days) => (
          <SelectItem key={days} value={days.toString()}>
            {days}d
          </SelectItem>
        ))}
        <SelectItem value="-1">Custom Lookback</SelectItem>
      </Select>

      {isCustomLookback && (
        <TextField.Root
          size="2"
          type="number"
          min="1"
          placeholder="Enter number of days"
          value={customDaysInput}
          onChange={(e) => {
            const value = e.target.value;
            setCustomDaysInput(value);
            const days = parseInt(value);
            if (days > 0 && !isNaN(days)) {
              const start = new Date();
              const end = new Date();
              start.setDate(end.getDate() - days);

              setDraftExploreState((prev) => ({
                ...prev,
                lookbackDays: days,
                startDate: start,
                endDate: end,
              }));
            }
          }}
        />
      )}
    </Flex>
  );
}
