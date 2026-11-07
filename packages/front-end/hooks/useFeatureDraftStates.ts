import {
  useEntityDraftStates,
  UseEntityDraftStatesReturn,
} from "./useEntityDraftStates";

export type { DraftStatusCounts } from "./useEntityDraftStates";
export type UseFeatureDraftStatesReturn = UseEntityDraftStatesReturn;

export function useFeatureDraftStates(): UseFeatureDraftStatesReturn {
  return useEntityDraftStates({
    path: "/features/draft-states",
    responseKey: "features",
  });
}
