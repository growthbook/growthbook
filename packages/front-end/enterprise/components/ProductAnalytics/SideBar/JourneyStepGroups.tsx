import React, { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowUp, PiPlus, PiX } from "react-icons/pi";
import type { JourneyDataset, JourneyStepGroup } from "shared/validators";
import { MAX_JOURNEY_STEP_GROUPS } from "shared/validators";
import {
  matchesGlob,
  stepGroupMatchCounts,
  suggestJourneyStepGroups,
} from "shared/journeys";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

type IndexedRule = JourneyStepGroup & { index: number };

type ColumnGroupState = {
  column: string;
  rules: IndexedRule[];
  sample: string[];
  effectiveCounts: number[];
  matchedCounts: number[];
};

function dismissKey(column: string, pattern: string): string {
  return `${column} :: ${pattern}`;
}

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
  // Not persisted: a dismissal would land in the fetch key and re-run the query.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const stepGroups = dataset.stepGroups ?? [];
  const columns = dataset.stepColumns.filter(Boolean);

  const columnStates: ColumnGroupState[] = columns.map((column) => {
    const rules = stepGroups
      .map((group, index) => ({ ...group, index }))
      .filter((group) => group.column === column);
    const sample = samples[column] ?? [];
    const { effective, matched } = stepGroupMatchCounts(sample, rules);

    return {
      column,
      rules,
      sample,
      effectiveCounts: effective,
      matchedCounts: matched,
    };
  });

  const suggestionsByColumn = columnStates.map(({ column, rules, sample }) => {
    const existing = rules.filter((r) => r.pattern);
    return suggestJourneyStepGroups(sample).filter((suggestion) => {
      if (dismissed.has(dismissKey(column, suggestion.pattern))) return false;
      return !existing.some(
        (rule) =>
          rule.pattern === suggestion.pattern ||
          suggestion.matchedValues.every((v) => matchesGlob(v, rule.pattern)),
      );
    });
  });

  if (!columns.length) return null;

  const editRules = (mutate: (groups: JourneyStepGroup[]) => void) => {
    const next = stepGroups.map((g) => ({ ...g }));
    mutate(next);
    onChange(next);
  };

  const addPatterns = (column: string, patterns: string[]) => {
    onChange([
      ...stepGroups,
      ...patterns.map((pattern) => ({ column, pattern })),
    ]);
  };

  const showColumnLabels = columns.length > 1;
  const atCap = stepGroups.length >= MAX_JOURNEY_STEP_GROUPS;

  return (
    <Flex direction="column" gap="2">
      <Text weight="medium">Group steps</Text>
      <Text size="sm" color="text-low">
        Collapse dynamic values into one step. <code>*</code> matches any text
        and <code>?</code> matches one character. The first matching pattern
        wins, and the pattern itself becomes the step label.
      </Text>

      {columnStates.map((state, columnIndex) => {
        const suggestions = suggestionsByColumn[columnIndex];
        const { column, rules, sample, effectiveCounts, matchedCounts } = state;

        return (
          <Flex key={column} direction="column" gap="2">
            {showColumnLabels && (
              <Text size="sm" weight="medium">
                {columnLabel(column)}
              </Text>
            )}

            {!disabled && suggestions.length > 0 && (
              <Callout
                status="info"
                size="sm"
                action={
                  <Flex gap="2" align="center">
                    {suggestions.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          addPatterns(
                            column,
                            suggestions.map((s) => s.pattern),
                          )
                        }
                      >
                        Apply all
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDismissed((prev) => {
                          const next = new Set(prev);
                          suggestions.forEach((s) =>
                            next.add(dismissKey(column, s.pattern)),
                          );
                          return next;
                        })
                      }
                    >
                      Dismiss
                    </Button>
                  </Flex>
                }
              >
                <Flex direction="column" gap="1">
                  <Text size="sm">
                    {suggestions.length === 1
                      ? "Found a pattern that looks dynamic:"
                      : `Found ${suggestions.length} patterns that look dynamic:`}
                  </Text>
                  {suggestions.map((suggestion) => (
                    <Flex
                      key={suggestion.pattern}
                      align="center"
                      justify="between"
                      gap="2"
                    >
                      <Text size="sm">
                        <code>{suggestion.pattern}</code>{" "}
                        <Text size="sm" color="text-low" as="span">
                          groups {suggestion.coverage} of {sample.length}{" "}
                          sampled values
                        </Text>
                      </Text>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          addPatterns(column, [suggestion.pattern])
                        }
                      >
                        Apply
                      </Button>
                    </Flex>
                  ))}
                </Flex>
              </Callout>
            )}

            {rules.map((rule, positionInColumn) => {
              const shadowed =
                !!rule.pattern &&
                matchedCounts[positionInColumn] > 0 &&
                effectiveCounts[positionInColumn] === 0;
              const noMatches =
                !!rule.pattern &&
                sample.length > 0 &&
                matchedCounts[positionInColumn] === 0;

              let warning: string | undefined;
              if (!rule.pattern) {
                warning = "Enter a pattern";
              } else if (shadowed) {
                warning = "Never used, an earlier pattern already covers it";
              } else if (noMatches) {
                warning = "No sampled values match";
              }

              return (
                <Flex key={rule.index} align="start" gap="2" width="100%">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      size="sm"
                      value={rule.pattern}
                      disabled={disabled}
                      placeholder="/article/*"
                      error={warning}
                      errorLevel={rule.pattern ? "warning" : "error"}
                      helpText={
                        !warning && sample.length > 0
                          ? `Groups ${effectiveCounts[positionInColumn]} of ${sample.length} sampled values`
                          : undefined
                      }
                      onChange={(e) =>
                        editRules((groups) => {
                          groups[rule.index] = {
                            ...groups[rule.index],
                            pattern: e.target.value,
                          };
                        })
                      }
                    />
                  </div>
                  {positionInColumn > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      title="Match this pattern before the one above"
                      onClick={() =>
                        editRules((groups) => {
                          const above = rules[positionInColumn - 1].index;
                          const moved = groups[rule.index];
                          groups[rule.index] = groups[above];
                          groups[above] = moved;
                        })
                      }
                    >
                      <PiArrowUp size={14} />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    title="Remove pattern"
                    onClick={() =>
                      onChange(stepGroups.filter((_, i) => i !== rule.index))
                    }
                  >
                    <PiX size={14} />
                  </Button>
                </Flex>
              );
            })}

            {!disabled && !atCap && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addPatterns(column, [""])}
              >
                <Flex align="center" gap="1">
                  <PiPlus size={14} />
                  Add pattern
                </Flex>
              </Button>
            )}
          </Flex>
        );
      })}
    </Flex>
  );
}
