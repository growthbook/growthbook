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
  return (
    <Field
      type="number"
      step={step}
      append="%"
      {...fieldProps}
      min={Object.keys(fieldProps).includes("min") ? fieldProps.min : 0}
      max={Object.keys(fieldProps).includes("max") ? fieldProps.max : 100}
      value={value !== undefined ? formatter.format(value * 100) : value}
      onChange={(event) => {
        const value =
          typeof event.target.value === "string" && event.target.value !== ""
            ? Number(event.target.value) / 100
            : undefined;

        onChange(value);
      }}
    />
  );
}
