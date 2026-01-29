import React, { useState } from "react";
import { Flex, TextField } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "shared/enterprise";
import { Select, SelectItem } from "@/ui/Select";

interface Props {
  block: DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>
  >;
}

export default function DateRangePicker({ block, setBlock }: Props) {
  const presetDays = [7, 14, 30, 90, 180, 365];

  const [isCustomLookback, setIsCustomLookback] = useState(() => {
    return !presetDays.includes(block.analysisSettings.lookbackDays);
  });

  const [customDaysInput, setCustomDaysInput] = useState(() => {
    return !presetDays.includes(block.analysisSettings.lookbackDays)
      ? block.analysisSettings.lookbackDays.toString()
      : "";
  });

  return (
    <Flex align="center" gap="2">
      <Select
        size="2"
        value={
          isCustomLookback ? "-1" : block.analysisSettings.lookbackDays + ""
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

            setBlock({
              ...block,
              analysisSettings: {
                ...block.analysisSettings,
                lookbackDays: 60,
                startDate: start,
                endDate: end,
              },
            });
          } else {
            setIsCustomLookback(false);
            const start = new Date();
            const end = new Date();
            start.setDate(end.getDate() - days);

            setBlock({
              ...block,
              analysisSettings: {
                ...block.analysisSettings,
                lookbackDays: days,
                startDate: start,
                endDate: end,
              },
            });
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

              setBlock({
                ...block,
                analysisSettings: {
                  ...block.analysisSettings,
                  lookbackDays: days,
                  startDate: start,
                  endDate: end,
                },
              });
            }
          }}
        />
      )}
    </Flex>
  );
}
