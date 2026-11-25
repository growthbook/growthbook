import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import { getQaOverrideWaitingFeatures } from "shared/util";
import {
  QaOverrideFilterKind,
  QaOverrideFormValues,
  buildQaOverrideBody,
  isQaOverrideFormComplete,
  qaOverrideBodyEquals,
  qaOverrideFormDefaults,
} from "@/services/qaOverrides";

export default function useQaOverrideForm({
  existing,
  defaultEnvironment,
  hashAttribute,
  variationIds,
  linkedFeatures,
}: {
  existing?: ExperimentQaOverrideInterface;
  defaultEnvironment: string;
  hashAttribute: string;
  variationIds: string[];
  linkedFeatures: LinkedFeatureInfo[];
}) {
  const form = useForm<QaOverrideFormValues>({
    defaultValues: qaOverrideFormDefaults(
      existing,
      defaultEnvironment,
      variationIds,
    ),
  });
  const values = form.watch();

  const addFilter = (kind: QaOverrideFilterKind) => {
    if (values.filters.includes(kind)) return;
    form.setValue("filters", [...values.filters, kind]);
    if (kind === "condition" && values.condition === "{}") {
      form.setValue("condition", JSON.stringify({ [hashAttribute]: "" }));
    }
    if (kind === "savedGroups" && values.savedGroups.length === 0) {
      form.setValue("savedGroups", [{ match: "any", ids: [] }]);
    }
  };
  const removeFilter = (kind: QaOverrideFilterKind) => {
    form.setValue(
      "filters",
      values.filters.filter((k) => k !== kind),
    );
    const empty = qaOverrideFormDefaults();
    form.setValue(kind, empty[kind]);
  };
  // For a field that counts as a filter only while it has a value.
  const setFilterActive = (kind: QaOverrideFilterKind, active: boolean) => {
    const current = form.getValues("filters");
    if (active === current.includes(kind)) return;
    form.setValue(
      "filters",
      active ? [...current, kind] : current.filter((k) => k !== kind),
    );
  };
  const setEnvironment = (environment: string) => {
    form.setValue("environment", environment);
    form.setValue("sdkConnections", []);
  };

  const waitingFeatures = useMemo(
    () =>
      values.environment
        ? getQaOverrideWaitingFeatures(
            { environment: values.environment },
            linkedFeatures,
          )
        : [],
    [values.environment, linkedFeatures],
  );

  const complete = isQaOverrideFormComplete(values);
  const body = complete ? buildQaOverrideBody(values) : null;
  const dirty =
    !existing ||
    !body ||
    !qaOverrideBodyEquals(body, {
      filters: existing.filters,
      assignment: existing.assignment,
    });

  return {
    form,
    values,
    addFilter,
    removeFilter,
    setFilterActive,
    setEnvironment,
    waitingFeatures,
    body,
    canSave: complete && dirty,
  };
}
