import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import { getQaOverrideWaitingFeatures } from "shared/util";
import {
  QA_OVERRIDE_FILTER_KINDS,
  QaOverrideFilterKind,
  QaOverrideFormValues,
  buildQaOverrideBody,
  isQaOverrideFormComplete,
  qaOverrideBodyEquals,
  qaOverrideFormDefaults,
} from "@/services/qaOverrides";

export const QA_OVERRIDE_FILTER_META: Record<
  QaOverrideFilterKind,
  { label: string; description: string }
> = {
  condition: {
    label: "Attribute",
    description: "Users with a specific id or email",
  },
  savedGroups: {
    label: "Saved Groups",
    description: "Members of a saved group, like a QA team",
  },
  sdkConnections: {
    label: "SDK Connections",
    description: "Only requests from specific SDK connections",
  },
  projects: {
    label: "Projects",
    description: "Only SDK connections in specific projects",
  },
};

/**
 * State of the add/edit override form: the fields, which filter cards are
 * open, and whether it can be saved (complete, and changed when editing).
 */
export default function useQaOverrideForm({
  existing,
  defaultEnvironment,
  hashAttribute,
  linkedFeatures,
}: {
  existing?: ExperimentQaOverrideInterface;
  defaultEnvironment: string;
  hashAttribute: string;
  linkedFeatures: LinkedFeatureInfo[];
}) {
  const form = useForm<QaOverrideFormValues>({
    defaultValues: qaOverrideFormDefaults(existing, defaultEnvironment),
  });
  const values = form.watch();

  const addFilter = (kind: QaOverrideFilterKind) => {
    if (values.filters.includes(kind)) return;
    form.setValue("filters", [...values.filters, kind]);
    // A first row, ready to type into, instead of an empty card.
    if (kind === "condition" && values.condition === "{}") {
      form.setValue("condition", JSON.stringify({ [hashAttribute]: "" }));
    }
    // Same for saved groups: open on the picker, not an "Add" link. An empty
    // group keeps the form incomplete until one is chosen.
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
  const setEnvironment = (environment: string) => {
    form.setValue("environment", environment);
    // Connections belong to one environment, so a different environment makes
    // any connection filter meaningless.
    form.setValue("sdkConnections", []);
  };

  const availableFilters = QA_OVERRIDE_FILTER_KINDS.filter(
    (k) => !values.filters.includes(k),
  );
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
    setEnvironment,
    availableFilters,
    waitingFeatures,
    body,
    canSave: complete && dirty,
  };
}
