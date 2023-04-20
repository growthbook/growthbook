import React from "react";
import { UseFormReturn } from "react-hook-form";
import SelectField from "@/components/Forms/SelectField";
import { capitalizeFirstLetter } from "@/services/utils";
import { ScopedSettings } from "@/services/settings/types";

export default function StatsEngineSelect({
  form,
  parentSettings,
  showDefault = true,
}: {
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  parentSettings?: ScopedSettings;
  showDefault?: boolean;
}) {
  const parentScopeId = parentSettings.statsEngine.meta.scopeApplied;
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
  if (parentScopeId) {
    options.unshift({
      label: `${capitalizeFirstLetter(parentScopeId)} default`,
      value: "",
    });
  }

  return (
    <SelectField
      label="Statistics Engine"
      containerClassName="mb-3"
      className="w-200px"
      sort={false}
      options={options}
      value={form.watch("statsEngine") ?? ""}
      onChange={(v) => form.setValue("statsEngine", v ?? undefined)}
      helpText={
        showDefault &&
        parentSettings.statsEngine.value && (
          <span className="ml-1">
            ({parentScopeId && parentScopeId + " "}default:{" "}
            {capitalizeFirstLetter(parentSettings.statsEngine.value)})
          </span>
        )
      }
    />
  );
}
