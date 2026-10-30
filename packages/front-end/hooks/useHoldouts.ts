import { useMemo } from "react";
import { startCase } from "lodash";
import { getHoldoutStage } from "shared/util";
import { HoldoutInterface } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { coveragePercentFormatter } from "@/services/utils";
import useApi from "./useApi";

// "Running", or "Running: Analysis Phase" once its analysis has started.
export function holdoutStatusLabel(
  holdout: Pick<HoldoutInterface, "analysisStartDate">,
  experiment: Pick<ExperimentInterfaceStringDates, "status">,
): string {
  return (
    startCase(experiment.status) +
    (getHoldoutStage(holdout, experiment) === "analysis-period"
      ? ": Analysis Phase"
      : "")
  );
}

// The holdout measures its held-out share against a comparison group as big.
export function holdoutSizeTip(size: number): string {
  const pct = (n: number) => coveragePercentFormatter.format(n);
  return `Of users the holdout targets, ${pct(size)} are held out and never reach this experiment. Another ${pct(size)} reach it as the holdout's comparison group, and the other ${pct(1 - 2 * size)} reach it unmeasured.`;
}

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
  /** Pass false where holdouts are only needed conditionally, to skip the fetch. */
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { data, error, mutate } = useApi<{
    holdouts: HoldoutInterface[];
    experiments: ExperimentInterfaceStringDates[];
    hasArchived: boolean;
  }>(
    `/holdout?project=${project || ""}&includeArchived=${
      includeArchived ? "1" : ""
    }`,
    { shouldRun: () => enabled },
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
    loading: enabled && !error && !data,
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
