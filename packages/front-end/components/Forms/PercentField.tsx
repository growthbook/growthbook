import { useState } from "react";
import Field, { FieldProps } from "./Field";

type Props = {
  value: number | undefined;
  onChange: (_: number | undefined) => void;
} & Omit<FieldProps, "ref" | "value" | "onChange">;

const formatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

export default function PercentField({
  step = 0.1,
  value,
  onChange,
  ...fieldProps
}: Props) {
  const [actualValue, setActualValue] = useState<number | undefined>(
    value !== undefined ? Number(formatter.format(value * 100)) : value
  );

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
