import {
  useEntityDraftStates,
  UseEntityDraftStatesReturn,
} from "./useEntityDraftStates";

export type UseConstantDraftStatesReturn = UseEntityDraftStatesReturn;

export function useConstantDraftStates(): UseConstantDraftStatesReturn {
  return useEntityDraftStates({
    path: "/constants-draft-states",
    responseKey: "constants",
  });
}
