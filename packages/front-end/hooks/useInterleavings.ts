import { ApiInterleavingInterface } from "shared/validators";
import { useMemo } from "react";
import useApi from "./useApi";

/** Fetches Interleaving experiments, optionally scoped to a project. */
export function useInterleavings(project?: string) {
  const path = `/api/v1/interleavings${
    project ? `?projectId=${encodeURIComponent(project)}` : ""
  }`;
  const { data, error, mutate } = useApi<{
    interleavings: ApiInterleavingInterface[];
  }>(path);

  const interleavings = useMemo(() => data?.interleavings ?? [], [data]);

  return {
    loading: !error && !data,
    interleavings,
    error,
    mutate,
  };
}

/** Fetches a single Interleaving experiment. */
export function useInterleaving(id?: string) {
  const { data, error, mutate } = useApi<{
    interleaving: ApiInterleavingInterface;
  }>(`/api/v1/interleavings/${id}`, { shouldRun: () => !!id });

  return {
    loading: !!id && !error && !data,
    interleaving: data?.interleaving,
    error,
    mutate,
  };
}
