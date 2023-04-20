import React from "react";
import { UseFormReturn } from "react-hook-form";
import { StatsEngine } from "back-end/types/stats";
import SelectField from "@/components/Forms/SelectField";
import { capitalizeFirstLetter } from "@/services/utils";
import { ScopedSettings } from "@/services/settings/types";

type FormReturn = UseFormReturn<{ statsEngine?: StatsEngine }>;

export default function StatsEngineSelect({
  form,
  parentSettings,
  showDefault = true,
}: {
  form: FormReturn;
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
      onChange={(v) =>
        form.setValue("statsEngine", (v as StatsEngine) ?? undefined)
      }
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
