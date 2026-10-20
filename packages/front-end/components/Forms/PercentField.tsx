import { useEffect, useState } from "react";
import Field, { FieldProps } from "./Field";
import { proportionToPercentInputValue } from "./percentFieldUtils";

type Props = {
  // All numeric props use proportions; this component owns the percent conversion.
  value: number | undefined;
  onChange: (_: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
} & Omit<
  FieldProps,
  | "ref"
  | "type"
  | "value"
  | "defaultValue"
  | "onChange"
  | "min"
  | "max"
  | "step"
>;

export default function PercentField({
  step = 0.001,
  min,
  max,
  value,
  onChange,
  ...fieldProps
}: Props) {
  const [percentInputValue, setPercentInputValue] = useState<
    number | undefined
  >(proportionToPercentInputValue(value));

  useEffect(() => {
    setPercentInputValue(proportionToPercentInputValue(value));
  }, [value, setPercentInputValue]);

  return (
    <Field
      size="legacy"
      type="number"
      step={step * 100}
      append="%"
      {...fieldProps}
      min={min === undefined ? undefined : min * 100}
      max={max === undefined ? undefined : max * 100}
      value={percentInputValue}
      onChange={(event) => {
        const percentInputValue =
          typeof event.target.value === "string" && event.target.value !== ""
            ? Number(event.target.value)
            : undefined;
        setPercentInputValue(percentInputValue);
        onChange(
          percentInputValue !== undefined
            ? percentInputValue / 100
            : percentInputValue,
        );
      }}
    />
  );
}
