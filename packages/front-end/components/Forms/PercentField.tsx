import { useEffect, useState } from "react";
import Field, { FieldProps } from "./Field";

type Props = {
  value: number | undefined;
  onChange: (_: number | undefined) => void;
} & Omit<FieldProps, "ref" | "value" | "onChange">;

const formatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

const validateAndFormatValue = (value: number | undefined) => {
  if (value === undefined) return value;
  if (isNaN(value)) return 0;
  if (value < 0 || 1 < value) return 0;
  return Number(formatter.format(value * 100));
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
