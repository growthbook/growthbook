import { useMemo } from "react";
import { HoldoutInterface } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import useApi from "./useApi";

// True when a holdout is enabled in at least one env — i.e. when it actually
// occupies the "Rule #1" slot in the rules list (see FeatureRules.tsx's
// `liveHoldoutActiveAnyEnv`). `envIds`, when provided, restricts the check
// to those env IDs (matches FeatureRules.tsx, which only counts enables in
// the org's current envs).
export function isHoldoutEnabledAnyEnv(
  holdout: HoldoutInterface | null | undefined,
  envIds?: string[],
): boolean {
  if (!holdout) return false;
  const settings = holdout.environmentSettings ?? {};
  if (envIds) return envIds.some((envId) => settings[envId]?.enabled);
  return Object.values(settings).some((s) => s?.enabled);
}

// Reference-form wrapper for callers that have a `{ holdout: { id } }` ref
// and a holdouts map (most diff renderers). Returns true when the referenced
// holdout exists and would occupy the Rule #1 slot. Relying on the ref alone
// over-counts by 1 when the holdout exists but is disabled everywhere.
export function holdoutOccupiesRuleSlot(
  holdoutRef: { id?: string } | null | undefined,
  holdoutsMap: Map<string, HoldoutInterface>,
  envIds?: string[],
): boolean {
  const id = holdoutRef?.id;
  if (!id) return false;
  return isHoldoutEnabledAnyEnv(holdoutsMap.get(id), envIds);
}

export function useHoldouts(
  project?: string,
  includeArchived: boolean = false,
) {
  const { data, error, mutate } = useApi<{
    holdouts: HoldoutInterface[];
    experiments: ExperimentInterfaceStringDates[];
    hasArchived: boolean;
  }>(
    `/holdout?project=${project || ""}&includeArchived=${
      includeArchived ? "1" : ""
    }`,
  );

  const holdouts = useMemo(() => data?.holdouts || [], [data]);

  const holdoutsMap = useMemo(
    () => new Map(holdouts.map((h) => [h.id, h])),
    [holdouts],
  );

  const experiments = useMemo(() => data?.experiments || [], [data]);
  const experimentsMap = useMemo(
    () => new Map(experiments.map((e) => [e.id, e])),
    [experiments],
  );

  const experimentToHoldoutsMap = useMemo(
    () => new Map(holdouts.map((h) => [h.experimentId, h])),
    [holdouts],
  );

  return {
    loading: !error && !data,
    holdouts: holdouts,
    holdoutsMap,
    experiments,
    experimentsMap,
    experimentToHoldoutsMap,
    error: error,
    mutateHoldouts: mutate,
    hasArchived: data?.hasArchived || false,
  };
}
