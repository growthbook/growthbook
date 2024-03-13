import { ReactNode } from "react";
import { StatsEngine } from "back-end/types/stats";
import { ScopedSettings } from "shared/settings";
import SelectField from "@front-end/components/Forms/SelectField";
import { capitalizeFirstLetter } from "@front-end/services/utils";

export default function StatsEngineSelect({
  parentSettings,
  showDefault = true,
  allowUndefined = true,
  label = "Statistics Engine",
  value,
  onChange,
  labelClassName = "font-weight-bold text-muted mr-2",
}: {
  value?: StatsEngine;
  parentSettings?: ScopedSettings;
  showDefault?: boolean;
  allowUndefined?: boolean;
  label?: ReactNode;
  onChange?: (v: StatsEngine) => void;
  labelClassName?: string;
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
      className="w-200px"
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
    />
  );
}
