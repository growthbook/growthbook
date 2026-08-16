import { useMemo, useRef } from "react";
import type {
  JourneyDataset,
  ProductAnalyticsResultRow,
} from "shared/validators";
import {
  buildJourneyViewState,
  type JourneyHistory,
  type JourneyViewModel,
} from "./useJourneyModel";

type PathStep = JourneyDataset["path"][number];

export function useJourneyViewState({
  familyKey,
  rows,
  dataset,
  rowPath,
  hasDimension,
  frontierLoading,
}: {
  familyKey: string;
  rows: ProductAnalyticsResultRow[];
  dataset: JourneyDataset | null;
  rowPath: PathStep[];
  hasDimension: boolean;
  frontierLoading: boolean;
}): { model: JourneyViewModel; history: JourneyHistory } | null {
  const historyRef = useRef<JourneyHistory | null>(null);
  const keyRef = useRef(familyKey);
  if (keyRef.current !== familyKey) {
    keyRef.current = familyKey;
    historyRef.current = null;
  }
  const state = useMemo(() => {
    if (!dataset) return null;
    const previousHistory =
      keyRef.current === familyKey ? historyRef.current : null;
    return buildJourneyViewState({
      rows,
      dataset,
      rowPath,
      hasDimension,
      previousHistory,
      frontierLoading,
    });
  }, [familyKey, dataset, rows, rowPath, hasDimension, frontierLoading]);
  if (state) {
    historyRef.current = state.history;
  }
  return state;
}
