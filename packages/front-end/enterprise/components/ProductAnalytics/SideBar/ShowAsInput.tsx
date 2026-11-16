import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCheck } from "react-icons/pi";
import type { ShowAs } from "shared/validators";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";

// Keyed by every ShowAs so a new option can't ship without a label.
const getLabels = (unit: string | null): Record<ShowAs, string> => ({
  total: "Event totals",
  per_unit: unit ? `Per ${unit}` : "Per unit",
});

export default function ShowAsInput({
  options,
  value,
  setValue,
  unit,
  metricName,
}: {
  options: readonly ShowAs[];
  value: ShowAs;
  setValue: (value: ShowAs) => void;
  /** The chart's identifier type, when every metric shares one. */
  unit: string | null;
  /** Names the trigger, since every mean metric card has one. */
  metricName: string;
}) {
  const [open, setOpen] = useState(false);
  const labels = getLabels(unit);
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
          aria-label={`Show as: ${labels[value]}, ${metricName}`}
        >
          Show as: {labels[value]}
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
            <Text>{labels[option]}</Text>
          </Flex>
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}
