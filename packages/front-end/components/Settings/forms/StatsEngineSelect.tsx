import { ReactNode } from "react";
import { StatsEngine } from "shared/types/stats";
import { ScopedSettings } from "shared/settings";
import SelectField from "@/components/Forms/SelectField";
import { capitalizeFirstLetter } from "@/services/utils";

export default function StatsEngineSelect({
  parentSettings,
  allowUndefined = true,
  label = "Statistics Engine",
  className = "w-200px",
  value,
  onChange,
  labelClassName = "mr-2",
  disabled,
}: {
  value?: StatsEngine;
  parentSettings?: ScopedSettings;
  allowUndefined?: boolean;
  label?: ReactNode;
  className?: string;
  onChange?: (v: StatsEngine) => void;
  labelClassName?: string;
  disabled?: boolean;
}) {
  const parentDefaultValue = parentSettings?.statsEngine?.value;
  const options = [
    {
      label: "Bayesian",
      value: "bayesian",
    },
    {
      label: "Frequentist",
      value: "frequentist",
    },
  ];
  if (allowUndefined) {
    options.unshift({
      label: parentDefaultValue
        ? `Default (${capitalizeFirstLetter(parentDefaultValue)})`
        : "Default",
      value: "",
    });
  }

  return (
    <SelectField
      label={label}
      className={className}
      containerClassName="mb-3"
      labelClassName={labelClassName}
      sort={false}
      options={options}
      value={value ?? options[0].value}
      onChange={(v) => {
        onChange?.(v as StatsEngine);
      }}
      formatOptionLabel={({ value, label }) => {
        if (!value) {
          return <em className="text-muted">{label}</em>;
        }
        return label;
      }}
      disabled={disabled}
    />
  );
}
