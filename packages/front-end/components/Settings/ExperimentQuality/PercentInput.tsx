import { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { TextField } from "@/ui/TextField";
import Text from "@/ui/Text";

// A whole-number box; typed text stays until it's valid, and leaving the box
// puts back the last valid value
export function NumberInput({
  value,
  min,
  max,
  disabled,
  ariaLabel,
  width = 72,
  onChange,
}: {
  value: number;
  min: number;
  max?: number;
  disabled?: boolean;
  ariaLabel: string;
  width?: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const isValid = (t: string) =>
    t.trim() !== "" &&
    Number.isInteger(Number(t)) &&
    Number(t) >= min &&
    (max === undefined || Number(t) <= max);
  return (
    <TextField
      type="number"
      size="sm"
      style={{ width }}
      min={min}
      max={max}
      value={text}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={!isValid(text)}
      inputClassName={isValid(text) ? undefined : "error"}
      onChange={(e) => {
        setText(e.target.value);
        if (isValid(e.target.value)) onChange(Number(e.target.value));
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

export default function PercentInput(
  props: Omit<Parameters<typeof NumberInput>[0], "min" | "max">,
) {
  return (
    <Flex align="center" gap="1">
      <NumberInput {...props} min={0} max={100} />
      <Text color="text-mid">%</Text>
    </Flex>
  );
}
