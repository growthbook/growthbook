import { useEffect, useId, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { TextField } from "@/ui/TextField";
import HelperText from "@/ui/HelperText";
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
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max?: number;
  disabled?: boolean;
  ariaLabel: string;
  width?: number;
  // Kept next to the box, before any error
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const errorId = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const isValid = (t: string) =>
    t.trim() !== "" &&
    Number.isInteger(Number(t)) &&
    Number(t) >= min &&
    (max === undefined || Number(t) <= max);
  const valid = isValid(text);
  return (
    // The message follows the box, so it doesn't split the sentence around it
    <Flex align="center" gap="2">
      <TextField
        type="number"
        size="sm"
        style={{ width }}
        min={min}
        max={max}
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={!valid}
        aria-describedby={valid ? undefined : errorId}
        inputClassName={valid ? undefined : "error"}
        onChange={(e) => {
          setText(e.target.value);
          if (isValid(e.target.value)) onChange(Number(e.target.value));
        }}
        onBlur={() => setText(String(value))}
      />
      {suffix ? <Text color="text-mid">{suffix}</Text> : null}
      {!valid ? (
        <span id={errorId}>
          <HelperText status="error" size="sm">
            {max === undefined
              ? `Enter a whole number, ${min} or more`
              : `Enter a whole number from ${min} to ${max}`}
          </HelperText>
        </span>
      ) : null}
    </Flex>
  );
}

export default function PercentInput(
  props: Omit<Parameters<typeof NumberInput>[0], "min" | "max" | "suffix">,
) {
  return <NumberInput {...props} min={0} max={100} suffix="%" />;
}
