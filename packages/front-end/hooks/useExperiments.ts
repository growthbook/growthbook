import {
  ExperimentInterfaceStringDates,
  ExperimentType,
} from "shared/types/experiment";
import { useMemo } from "react";
import { HoldoutInterface } from "shared/validators";
import useApi from "./useApi";

export function useExperiments(
  project?: string,
  includeArchived: boolean = false,
  type?: ExperimentType,
  { includeTempRollouts = false }: { includeTempRollouts?: boolean } = {},
) {
  const { data, error, mutate } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
    hasArchived: boolean;
    holdouts: HoldoutInterface[];
    // Stopped experiments whose temporary rollout is actually being served.
    // Present only when requested with includeTempRollouts.
    tempRolloutExperimentIds?: string[];
  }>(
    `/experiments?project=${project || ""}&includeArchived=${
      includeArchived ? "1" : ""
    }&type=${type || ""}&includeTempRollouts=${includeTempRollouts ? "1" : ""}`,
  );

  const experiments = useMemo(() => data?.experiments || [], [data]);

  const experimentsMap = useMemo(
    () => new Map(experiments.map((e) => [e.id, e])),
    [experiments],
  );

  const holdouts = useMemo(() => data?.holdouts || [], [data]);

  const tempRolloutExperimentIds = useMemo(
    () => data?.tempRolloutExperimentIds || [],
    [data],
  );

  return {
    loading: !error && !data,
    experiments: experiments,
    experimentsMap,
    holdouts: holdouts,
    error: error,
    mutateExperiments: mutate,
    hasArchived: data?.hasArchived || false,
    tempRolloutExperimentIds,
  };
}
