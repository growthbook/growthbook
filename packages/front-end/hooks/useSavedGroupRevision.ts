import { SavedGroupInterface } from "shared/types/saved-group";
import { useEntityRevision } from "@/hooks/useEntityRevision";

export function useSavedGroupRevision(
  savedGroupId: string | undefined,
  savedGroupMutate: () => void,
  savedGroup?: SavedGroupInterface,
) {
  return useEntityRevision({
    entityType: "saved-group",
    entityId: savedGroupId,
    entityMutate: savedGroupMutate,
    entity: savedGroup,
    ownerId: savedGroup?.owner,
  });
}
