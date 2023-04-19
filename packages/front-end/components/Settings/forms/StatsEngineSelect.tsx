import React from "react";
import { UseFormReturn } from "react-hook-form";
// todo: use front-end types
import {
  ScopedSettings,
  ScopeDefinition,
} from "back-end/src/services/settings/types";
import SelectField from "@/components/Forms/SelectField";
import { capitalizeFirstLetter } from "@/services/utils";

// todo: replace this with meta.appliedScope
const scopeParents = {
  project: "organization",
  experiment: "project",
  report: "experiment",
};

export default function StatsEngineSelect({
  form,
  parentScope,
  scopeId,
  showDefault = true,
}: {
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  parentScope?: ScopedSettings;
  scopeId?: keyof ScopeDefinition | "organization";
  showDefault?: boolean;
}) {
  const parentScopeId = scopeParents[scopeId];
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
        parentScope && (
          <span className="ml-1">
            ({parentScopeId && parentScopeId + " "}default:{" "}
            {capitalizeFirstLetter(parentScope.statsEngine)})
          </span>
        )
      }
    />
  );
}
