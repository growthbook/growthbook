import { SavedGroupInterface } from "shared/types/saved-group";
import { Revision } from "shared/enterprise";
import { DraftMode } from "@/components/DraftSelector";
import RevisionDraftSelectorForChanges from "@/components/Revision/RevisionDraftSelectorForChanges";

export type { DraftMode };

// Thin saved-group wrapper around the shared RevisionDraftSelectorForChanges;
// kept only so saved-group call sites read in their own vocabulary.
export default function SavedGroupDraftSelectorForChanges({
  savedGroup,
  ...rest
}: {
  savedGroup: SavedGroupInterface;
  openRevisions: Revision[];
  allRevisions: Revision[];
  mode: DraftMode;
  setMode: (m: DraftMode) => void;
  selectedDraftId: string | null;
  setSelectedDraftId: (v: string | null) => void;
  canAutoPublish: boolean;
  approvalRequired: boolean;
  defaultExpanded?: boolean;
  triggerPrefix?: string;
  metadataOnly?: boolean;
  hideExisting?: boolean;
}) {
  return <RevisionDraftSelectorForChanges entityId={savedGroup.id} {...rest} />;
}
