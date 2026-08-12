import { SavedGroupInterface } from "shared/types/saved-group";
import { Revision } from "shared/enterprise";
import CompareRevisionsModal from "@/components/Revision/CompareRevisionsModal";
import { REVISION_SAVED_GROUP_DIFF_CONFIG } from "@/components/Revision/RevisionDiffConfig";

export interface Props {
  savedGroup: SavedGroupInterface;
  allRevisions: Revision[];
  currentRevisionId: string | null;
  onClose: () => void;
  // Opens directly in "preview draft vs live" mode for this revision
  initialPreviewDraft?: string;
  initialMode?: "most-recent-live";
  requiresApproval?: boolean;
}

// Thin wrapper around the shared, entity-agnostic CompareRevisionsModal.
export default function CompareSavedGroupRevisionsModal({
  savedGroup,
  ...rest
}: Props) {
  return (
    <CompareRevisionsModal
      liveEntity={savedGroup}
      entityId={savedGroup.id}
      diffConfig={REVISION_SAVED_GROUP_DIFF_CONFIG}
      {...rest}
    />
  );
}
