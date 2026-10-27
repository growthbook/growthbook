import isEqual from "lodash/isEqual";
import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import type {
  ExperimentChangeType,
  PostExperimentChangesBody,
} from "shared/validators";
import { getNamespaceRanges, NamespaceValue } from "shared/util";
import { mergeContiguousRanges } from "@/components/Features/NamespaceSelectorUtils";

type ChangeFields = Omit<
  Extract<PostExperimentChangesBody, { changeType: "advanced" }>,
  "changeType" | "releasePlan" | "reason" | "dryRun" | "ignoreWarnings"
>;

function toApiNamespace(
  namespace: ExperimentTargetingData["namespace"],
): Exclude<ChangeFields["namespace"], undefined> {
  if (!namespace?.enabled) return null;
  return {
    namespaceId: namespace.name,
    ranges: mergeContiguousRanges(
      getNamespaceRanges(namespace as NamespaceValue),
    ),
  };
}

/**
 * The Make Changes request for what the wizard's form holds. Only the fields
 * of `changeType` are sent; for `targeting` and `advanced`, only the ones the
 * user changed, so untouched fields keep their stored values.
 */
export function buildMakeChangesBody({
  experiment,
  changeType,
  values,
  defaults,
}: {
  experiment: ExperimentInterfaceStringDates;
  changeType: ExperimentChangeType;
  values: ExperimentTargetingData;
  defaults: Partial<ExperimentTargetingData>;
}): PostExperimentChangesBody {
  const fields: Required<ChangeFields> = {
    coverage: values.coverage,
    trafficSplit: getLatestPhaseVariations(experiment).map((v, i) => ({
      variationId: v.id,
      weight: values.variationWeights[i] ?? 0,
    })),
    targetingCondition: values.condition || null,
    savedGroups: values.savedGroups ?? [],
    prerequisites: values.prerequisites ?? [],
    namespace: toApiNamespace(values.namespace),
  };
  const changed: Record<keyof ChangeFields, boolean> = {
    coverage: values.coverage !== defaults.coverage,
    trafficSplit: !isEqual(values.variationWeights, defaults.variationWeights),
    targetingCondition: (values.condition || "") !== (defaults.condition || ""),
    savedGroups: !isEqual(values.savedGroups ?? [], defaults.savedGroups ?? []),
    prerequisites: !isEqual(
      values.prerequisites ?? [],
      defaults.prerequisites ?? [],
    ),
    namespace: !isEqual(fields.namespace, toApiNamespace(defaults.namespace)),
  };
  const pickChanged = (keys: (keyof ChangeFields)[]) =>
    Object.fromEntries(
      keys.filter((k) => changed[k]).map((k) => [k, fields[k]]),
    ) as ChangeFields;

  switch (changeType) {
    case "coverage":
      return { changeType, coverage: fields.coverage };
    case "weights":
      return { changeType, trafficSplit: fields.trafficSplit };
    case "namespace":
      return { changeType, namespace: fields.namespace };
    case "new-phase":
      return { changeType };
    case "targeting":
      return {
        changeType,
        ...pickChanged(["targetingCondition", "savedGroups", "prerequisites"]),
      };
    case "advanced":
      return {
        changeType,
        ...pickChanged([
          "coverage",
          "trafficSplit",
          "targetingCondition",
          "savedGroups",
          "prerequisites",
          "namespace",
        ]),
      };
  }
}
