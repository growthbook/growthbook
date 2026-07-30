import { Revision } from "shared/enterprise";
import { DraftMode } from "@/components/DraftSelector";
import RevisionDraftSelectorForChanges from "@/components/Revision/RevisionDraftSelectorForChanges";

export type { DraftMode };

// Thin constant wrapper around the shared RevisionDraftSelectorForChanges.
// Constants opt out of approval-aware status badges in the picker dropdown.
export default function ConstantDraftSelectorForChanges({
  constantId,
  ...rest
}: {
  constantId: string;
  openRevisions: Revision[];
  allRevisions: Revision[];
  mode: DraftMode;
  setMode: (m: DraftMode) => void;
  selectedDraftId: string | null;
  setSelectedDraftId: (v: string | null) => void;
  canAutoPublish: boolean;
  approvalRequired: boolean;
  metadataOnly?: boolean;
  defaultExpanded?: boolean;
  triggerPrefix?: string;
  hideExisting?: boolean;
}) {
  return (
    <RevisionDraftSelectorForChanges
      entityId={constantId}
      dropdownRequiresApproval={false}
      {...rest}
    />
  );
}
