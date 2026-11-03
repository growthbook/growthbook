import React from "react";
import { Flex } from "@radix-ui/themes";
import type { JourneyDataset, JourneyStepGroup } from "shared/validators";
import { MAX_JOURNEY_STEP_GROUPS } from "shared/validators";
import { suggestJourneyStepGroups } from "shared/journeys";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";

export default function JourneyStepGroups({
  dataset,
  samples,
  columnLabel,
  onChange,
  disabled,
}: {
  dataset: JourneyDataset;
  samples: Record<string, string[]>;
  columnLabel: (column: string) => string;
  onChange: (stepGroups: JourneyStepGroup[]) => void;
  disabled?: boolean;
}) {
  const stepGroups = dataset.stepGroups ?? [];
  const columns = dataset.stepColumns.filter(Boolean);
  if (!columns.length) return null;

  const showColumnLabels = columns.length > 1;

  const setColumnPatterns = (column: string, patterns: string[]) => {
    const others = stepGroups.filter((g) => g.column !== column);
    const next = [
      ...others,
      ...patterns
        .filter(Boolean)
        .slice(0, Math.max(0, MAX_JOURNEY_STEP_GROUPS - others.length))
        .map((pattern) => ({ column, pattern })),
    ];
    onChange(next);
  };

  return (
    <Flex direction="column" gap="2">
      <Text weight="medium">Combine similar</Text>
      {columns.map((column) => {
        const value = stepGroups
          .filter((g) => g.column === column)
          .map((g) => g.pattern)
          .filter(Boolean);
        const suggestions = suggestJourneyStepGroups(samples[column] ?? []);
        const suggestionValues = new Set(suggestions.map((s) => s.pattern));
        const options = [
          ...suggestions.map((s) => ({ label: s.pattern, value: s.pattern })),
          ...value
            .filter((v) => !suggestionValues.has(v))
            .map((v) => ({ label: v, value: v })),
        ];
        return (
          <MultiSelectField
            key={column}
            label={showColumnLabels ? columnLabel(column) : undefined}
            labelWeight="medium"
            creatable
            sort={false}
            disabled={disabled}
            value={value}
            options={options}
            onChange={(patterns) => setColumnPatterns(column, patterns)}
            placeholder="Add a pattern..."
          />
        );
      })}
    </Flex>
  );
}
