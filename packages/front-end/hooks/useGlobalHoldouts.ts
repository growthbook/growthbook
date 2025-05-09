import { useMemo } from "react";
import useApi from "./useApi";
import { GlobalHoldoutInterface } from "back-end/types/global-holdout";

export function useGlobalHoldouts() {
  const { data, error, mutate } = useApi<{
    status: number;
    globalHoldouts: GlobalHoldoutInterface[];
  }>("/global-holdout");

  console.log("hook", {data, error})

  const holdouts = useMemo(() => data?.globalHoldouts || [], [data]);

  const holdoutsMap = useMemo(
    () => new Map(holdouts.map((h) => [h.id, h])),
    [holdouts]
  );

  return {
    loading: !error && !data,
    holdouts: holdouts,
    holdoutsMap,
    error: error,
    mutateHoldouts: mutate,
  };
}
