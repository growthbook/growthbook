import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useMemo } from "react";
import useApi from "./useApi";

export function useExperiments(
  project?: string,
  includeArchived: boolean = false
) {
  const { data, error, mutate } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
    hasArchived: boolean;
  }>(
    `/experiments?project=${project || ""}&includeArchived=${
      includeArchived ? "1" : ""
    }`
  );

  const experiments = useMemo(() => data?.experiments || [], [data]);

  const experimentsMap = useMemo(
    () => new Map(experiments.map((e) => [e.id, e])),
    [experiments]
  );

  return {
    loading: !error && !data,
    experiments: experiments,
    experimentsMap,
    error: error,
    mutateExperiments: mutate,
    hasArchived: data?.hasArchived || false,
  };
}
