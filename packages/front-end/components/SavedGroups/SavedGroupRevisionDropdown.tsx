import { Revision } from "shared/enterprise";
import RevisionDropdown from "@/components/Revision/RevisionDropdown";

export interface Props {
  savedGroupId: string;
  allRevisions: Revision[];
  selectedRevisionId: string | null;
  onSelectRevision: (revision: Revision | null) => void;
  requiresApproval?: boolean;
  draftsOnly?: boolean;
  context?: "header";
}

// Thin saved-group wrapper around the shared Revision-model <RevisionDropdown>:
// it simply scopes the "show discarded" preference by the saved-group id (via
// entityId). All mapping/rendering lives in the one shared component so the two
// can't drift — kept only so saved-group call sites read in their own vocabulary.
export default function SavedGroupRevisionDropdown({
  savedGroupId,
  allRevisions,
  selectedRevisionId,
  onSelectRevision,
  requiresApproval,
  draftsOnly,
  context,
}: Props) {
  return (
    <RevisionDropdown
      entityId={savedGroupId}
      allRevisions={allRevisions}
      selectedRevisionId={selectedRevisionId}
      onSelectRevision={onSelectRevision}
      requiresApproval={requiresApproval}
      draftsOnly={draftsOnly}
      context={context}
    />
  );
}
