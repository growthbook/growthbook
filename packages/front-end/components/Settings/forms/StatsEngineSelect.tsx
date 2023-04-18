import React from "react";
import { UseFormReturn } from "react-hook-form";
import SelectField from "@/components/Forms/SelectField";
import { capitalizeFirstLetter } from "@/services/utils";

const scopeParents = {
  project: "organization",
  experiment: "project",
  report: "experiment",
};

export default function StatsEngineSelect({
  form,
  formKey = "statsEngine",
  scope,
  currentScope,
  showDefault = true,
}: {
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  formKey?: string;
  // eslint-disable-next-line
  scope?: any;
  currentScope?: string;
  showDefault?: boolean;
}) {
  const parentScope = scopeParents[currentScope];
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
  if (parentScope) {
    options.unshift({
      label: `${capitalizeFirstLetter(parentScope)} default`,
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
      value={form.watch(formKey) ?? ""}
      onChange={(v) => form.setValue(formKey, v ?? undefined)}
      helpText={
        showDefault &&
        scope && (
          <span className="ml-1">
            ({parentScope && parentScope + " "}default: {scope.statsEngine})
          </span>
        )
      }
    />
  );
}
