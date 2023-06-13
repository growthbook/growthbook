import { ReactNode } from "react";
import { UseFormReturn } from "react-hook-form";
import { StatsEngine } from "back-end/types/stats";
import { ProjectSettings } from "back-end/types/project";
import { OrganizationSettings } from "back-end/types/organization";
import { ScopedSettings } from "shared/settings";
import SelectField from "@/components/Forms/SelectField";
import { capitalizeFirstLetter } from "@/services/utils";

export default function StatsEngineSelect({
  form,
  parentSettings,
  showDefault = true,
  allowUndefined = true,
  label = "Statistics Engine",
  onChange,
}: {
  form: UseFormReturn<OrganizationSettings | ProjectSettings>;
  parentSettings?: ScopedSettings;
  showDefault?: boolean;
  allowUndefined?: boolean;
  label?: ReactNode;
  onChange?: (v: StatsEngine) => void;
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
      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'null' is not assignable to type 'string'.
      value: null,
    });
  }

  return (
    <SelectField
      label={label}
      className="w-200px"
      containerClassName="mb-3"
      labelClassName="font-weight-bold text-muted mr-2"
      sort={false}
      options={options}
      value={form.watch("statsEngine") ?? options[0].value}
      onChange={(v) => {
        onChange?.(v as StatsEngine);
        form.setValue("statsEngine", (v as StatsEngine) || undefined);
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
