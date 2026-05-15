import {
  ExperimentInterfaceStringDates,
  ExperimentType,
} from "shared/types/experiment";
import { useMemo } from "react";
import { HoldoutInterface } from "shared/validators";
import useApi, { UseApiOptions } from "./useApi";

export function useExperiments(
  project?: string,
  includeArchived: boolean = false,
  type?: ExperimentType,
  apiOptions?: UseApiOptions,
) {
  const { data, error, mutate } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
    hasArchived: boolean;
    holdouts: HoldoutInterface[];
  }>(
    `/experiments?project=${project || ""}&includeArchived=${
      includeArchived ? "1" : ""
    }&type=${type || ""}`,
    apiOptions,
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
