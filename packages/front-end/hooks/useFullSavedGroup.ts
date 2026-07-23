import { SavedGroupInterface } from "shared/types/saved-group";
import useApi from "@/hooks/useApi";

/**
 * Fetches one full saved group, including the heavy `condition` and `values`
 * fields that `/organization/definitions` omits. Use for edit/detail/diff;
 * for lists, prefer the light `savedGroups` from `useDefinitions()`.
 */
export function useFullSavedGroup(id: string | undefined | null) {
  const { data, error, mutate } = useApi<{ savedGroup: SavedGroupInterface }>(
    id ? `/saved-groups/${id}` : "",
  );
  return { savedGroup: data?.savedGroup, error, mutate };
}
