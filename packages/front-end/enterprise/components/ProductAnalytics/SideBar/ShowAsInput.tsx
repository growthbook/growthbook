import { useState } from "react";
import { PiCaretDown } from "react-icons/pi";
import type { ShowAs } from "shared/validators";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";

// Keyed by every ShowAs so a new option can't ship without a label.
const LABELS: Record<ShowAs, string> = {
  total: "Event totals",
  per_unit: "Per unit",
};

export default function ShowAsInput({
  options,
  value,
  setValue,
}: {
  options: readonly ShowAs[];
  value: ShowAs;
  setValue: (value: ShowAs) => void;
}) {
  const [open, setOpen] = useState(false);
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
        >
          Show as {LABELS[value].toLowerCase()}
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
          <Text>{LABELS[option]}</Text>
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}
