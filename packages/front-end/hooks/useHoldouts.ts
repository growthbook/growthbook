import { useMemo } from "react";
import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "./useApi";

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
