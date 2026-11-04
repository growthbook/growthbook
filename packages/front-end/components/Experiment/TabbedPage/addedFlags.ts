import type { FeatureInterface } from "shared/types/feature";
import type { LinkedFeatureInfo } from "shared/types/experiment";
import type {
  ExperimentChangesBody,
  ExperimentRefVariation,
  ExperimentRuleEnvironments,
} from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useWatching } from "@/services/WatchProvider";
import track from "@/services/track";
import { useStagedState } from "./ExperimentEdits";

type NewFlag = NonNullable<
  ExperimentChangesBody["createFeatures"]
>[number]["feature"];

// A flag added on the page: linked when the page saves, or created first when
// `newFlag` is set.
export type AddedFlag = {
  feature: FeatureInterface;
  newFlag: NewFlag | null;
  values: ExperimentRefVariation[];
  sparse: boolean;
  environments: ExperimentRuleEnvironments;
  allowUnscopedRules: boolean;
};

export function useAddedFlags() {
  return useStagedState<AddedFlag[]>("added-flags", []);
}

// A flag's link, added, linked again, removed or kept, is one edit.
export const linkEditId = (featureId: string) => `link:${featureId}`;

// For a flag created from an experiment, once it's saved.
export function useFlagCreated() {
  const { refreshTags } = useDefinitions();
  const { refreshWatching } = useWatching();
  return (
    feature: Pick<FeatureInterface, "valueType" | "description" | "tags">,
  ) => {
    track("Feature Created", {
      valueType: feature.valueType,
      hasDescription: !!feature.description,
      initialRule: "experiment-ref",
    });
    refreshTags(feature.tags || []);
    refreshWatching();
  };
}

export function addedFlagChanges(
  added: AddedFlag,
  values: ExperimentRefVariation[] = added.values,
  sparse: boolean = added.sparse,
): ExperimentChangesBody {
  const link = {
    variations: values,
    ...(sparse && { sparse: true }),
    environments: added.environments,
  };
  return {
    ...(added.allowUnscopedRules && { allowUnscopedRules: true }),
    ...(added.newFlag
      ? { createFeatures: [{ feature: added.newFlag, ...link }] }
      : { linkFeatures: [{ featureId: added.feature.id, ...link }] }),
  };
}

// Its column reads it as a flag linked again: no rule yet, and the one the
// save adds.
export function addedFlagInfo(added: AddedFlag): LinkedFeatureInfo {
  return {
    feature: added.feature,
    state: "discarded",
    values: added.values,
    sparse: added.sparse,
    valuesFrom: "",
    inconsistentValues: false,
    rulesAbove: false,
    environmentStates: {},
    relinkFrom: {
      values: added.values,
      sparse: added.sparse,
      allEnvironments: added.environments.allEnvironments,
      environments: added.environments.environments,
    },
  };
}
