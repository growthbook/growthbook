import {
  ExperimentInterfaceStringDates,
  ExperimentType,
} from "back-end/types/experiment";
import { useMemo } from "react";
import { HoldoutInterface } from "shared/src/validators/holdout";
import useApi from "./useApi";

export function useExperiments(
  project?: string,
  includeArchived: boolean = false,
  type?: ExperimentType,
) {
  const { data, error, mutate } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
    hasArchived: boolean;
    holdouts: HoldoutInterface[];
  }>(
    `/experiments?project=${project || ""}&includeArchived=${
      includeArchived ? "1" : ""
    }&type=${type || ""}`,
  );

  const experiments = useMemo(() => data?.experiments || [], [data]);

  const experimentsMap = useMemo(
    () => new Map(experiments.map((e) => [e.id, e])),
    [experiments],
  );

  const holdouts = useMemo(() => data?.holdouts || [], [data]);

  return {
    loading: !error && !data,
    experiments: experiments,
    experimentsMap,
    holdouts: holdouts,
    error: error,
    mutateExperiments: mutate,
    hasArchived: data?.hasArchived || false,
  };
}
