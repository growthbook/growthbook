import {
  useEntityDraftStates,
  type UseEntityDraftStatesReturn,
  type DraftStatusCounts,
} from "./useEntityDraftStates";

export type { DraftStatusCounts };
export type UseSavedGroupDraftStatesReturn = UseEntityDraftStatesReturn;

export function useSavedGroupDraftStates(): UseSavedGroupDraftStatesReturn {
  return useEntityDraftStates({
    path: "/saved-groups/draft-states",
    responseKey: "groups",
  });
}
