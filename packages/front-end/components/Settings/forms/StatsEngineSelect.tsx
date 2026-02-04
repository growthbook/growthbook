import { ReactNode } from "react";
import { StatsEngine } from "shared/types/stats";
import { ScopedSettings } from "shared/settings";
import SelectField from "@/components/Forms/SelectField";
import { capitalizeFirstLetter } from "@/services/utils";

export default function StatsEngineSelect({
  parentSettings,
  showDefault = true,
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
  showDefault?: boolean;
  allowUndefined?: boolean;
  label?: ReactNode;
  className?: string;
  onChange?: (v: StatsEngine) => void;
  labelClassName?: string;
  disabled?: boolean;
}) {
  const parentScopeId = parentSettings?.statsEngine?.meta?.scopeApplied;
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
      label: parentScopeId
        ? capitalizeFirstLetter(parentScopeId) + " default"
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
      helpText={
        showDefault &&
        parentSettings?.statsEngine?.value && (
          <span className="ml-1">
            ({parentScopeId && parentScopeId + " "}default:{" "}
            {capitalizeFirstLetter(parentSettings?.statsEngine?.value)})
          </span>
        )
      }
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
