import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "./useApi";

export function useExperiments(project?: string) {
  const { data, error, mutate } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(`/experiments?project=${project || ""}`);

  return {
    loading: !error && !data,
    experiments: data?.experiments || [],
    error: error,
    mutateExperiments: mutate,
  };
}
