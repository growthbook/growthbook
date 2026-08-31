import { useEffect, useState } from "react";
import Field, { FieldProps } from "./Field";

type Props = {
  value: number | undefined;
  onChange: (_: number | undefined) => void;
} & Omit<FieldProps, "ref" | "value" | "onChange">;

const validateAndFormatValue = (value: number | undefined) => {
  if (value === undefined) return value;
  if (isNaN(value)) return 0;
  if (value < 0 || 1 < value) return 0;
  // Numeric only — locale-formatted strings become NaN under comma-decimal locales.
  return Math.round(value * 10000) / 100;
};

export default function PercentField({
  step = 0.1,
  value,
  onChange,
  ...fieldProps
}: Props) {
  const [actualValue, setActualValue] = useState<number | undefined>(
    validateAndFormatValue(value),
  );

  useEffect(() => {
    setActualValue(validateAndFormatValue(value));
  }, [value, setActualValue]);

  return (
    <Field
      size="legacy"
      type="number"
      step={step}
      append="%"
      {...fieldProps}
      min={Object.keys(fieldProps).includes("min") ? fieldProps.min : 0}
      max={Object.keys(fieldProps).includes("max") ? fieldProps.max : 100}
      value={actualValue}
      onChange={(event) => {
        const value =
          typeof event.target.value === "string" && event.target.value !== ""
            ? Number(event.target.value)
            : undefined;
        setActualValue(value);
        onChange(value !== undefined ? value / 100 : value);
      }}
    />
  );
}
