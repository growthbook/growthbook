import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCheck } from "react-icons/pi";
import type { ShowAs } from "shared/validators";
import type { FactMetricType } from "shared/types/fact-table";
import { getShowAsLabel } from "shared/enterprise";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";

// A mean metric's total sums event values, while a proportion's counts
// converting units, so a mean's total is its own option.
type OptionKey = ShowAs | "event_totals";

// Each option's name, and how it calculates its value. "Per unit" and "Per
// Population member" differ only in who counts, which their labels don't say.
const getOptionText = (
  unit: string | null,
): Record<OptionKey, { label: string; description: string }> => ({
  total: {
    label: getShowAsLabel("total", unit),
    description: `Count of every ${unit ?? "unit"} that converted`,
  },
  event_totals: {
    label: "Event totals",
    // Each unit's value is aggregated first (e.g. its max), then summed.
    description: `Sum of every ${unit ?? "unit"}'s value`,
  },
  per_unit: {
    label: getShowAsLabel("per_unit", unit),
    description: `Average per ${unit ?? "unit"} with at least one event`,
  },
  percent_of_population: {
    label: getShowAsLabel("percent_of_population", unit),
    description: "Share of Population members who converted",
  },
  per_population_member: {
    label: getShowAsLabel("per_population_member", unit),
    description:
      "Average per Population member, including members with no events",
  },
});

export default function ShowAsInput({
  options,
  value,
  setValue,
  unit,
  metricName,
  metricType,
}: {
  options: readonly ShowAs[];
  value: ShowAs;
  setValue: (value: ShowAs) => void;
  /** The chart's identifier type, when every metric shares one. */
  unit: string | null;
  /** Names the trigger, since every metric card with options has one. */
  metricName: string;
  /** Undefined when the metric isn't found. */
  metricType: FactMetricType | undefined;
}) {
  const [open, setOpen] = useState(false);
  const optionText = getOptionText(unit);
  const optionKey = (showAs: ShowAs): OptionKey =>
    showAs === "total" && metricType === "mean" ? "event_totals" : showAs;
  const describeOption = (showAs: ShowAs) => optionText[optionKey(showAs)];
  const label = (showAs: ShowAs) => describeOption(showAs).label;
  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          size="sm"
          variant="ghost"
          icon={<PiCaretDown />}
          iconPosition="right"
          aria-label={`Show as: ${label(value)}, ${metricName}`}
        >
          Show as: {label(value)}
        </Button>
      }
    >
      {options.map((option) => (
        <DropdownMenuItem
          key={option}
          tooltip={describeOption(option).description}
          tooltipSide="right"
          onClick={() => {
            setValue(option);
            setOpen(false);
          }}
        >
          <Flex align="center" gap="2">
            <Flex align="center" width="20px">
              {option === value ? <PiCheck size={16} /> : null}
            </Flex>
            <Text>{label(option)}</Text>
          </Flex>
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}
