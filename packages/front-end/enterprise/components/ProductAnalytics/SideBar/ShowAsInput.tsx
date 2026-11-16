import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCheck } from "react-icons/pi";
import type { ShowAs } from "shared/validators";
import type { FactMetricType } from "shared/types/fact-table";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";

// A mean metric's total sums event values; a proportion's counts converting
// units, so only a mean's total is labelled as events.
type LabelKey = ShowAs | "event_totals";

// Keyed by every ShowAs so a new option can't ship without a label.
const getLabels = (unit: string | null): Record<LabelKey, string> => ({
  total: "Total",
  event_totals: "Event totals",
  per_unit: unit ? `Per ${unit}` : "Per unit",
  percent_of_population: "% of Population",
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
  /** Undefined while the metric loads. */
  metricType: FactMetricType | undefined;
}) {
  const [open, setOpen] = useState(false);
  const allLabels = getLabels(unit);
  const label = (showAs: ShowAs) =>
    allLabels[
      showAs === "total" && metricType === "mean" ? "event_totals" : showAs
    ];
  // Nothing to choose (e.g. while the metric loads), so show the saved mode.
  if (options.length <= 1) {
    return (
      <Text size="sm" color="text-mid">
        Show as: {label(value)}
      </Text>
    );
  }
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
