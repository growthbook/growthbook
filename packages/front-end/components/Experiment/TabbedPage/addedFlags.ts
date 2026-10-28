import type { FeatureInterface } from "shared/types/feature";
import type { LinkedFeatureInfo } from "shared/types/experiment";
import type {
  ExperimentChangesBody,
  ExperimentRefVariation,
  ExperimentRuleEnvironments,
} from "shared/validators";
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

export const addedFlagEditId = (featureId: string) => `link:${featureId}`;

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
