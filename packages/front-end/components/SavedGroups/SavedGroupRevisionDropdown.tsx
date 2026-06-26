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

// Thin wrapper around the shared, entity-agnostic RevisionDropdown. Kept so
// existing saved-group call sites don't have to change.
export default function SavedGroupRevisionDropdown({
  savedGroupId,
  ...rest
}: Props) {
  return <RevisionDropdown entityId={savedGroupId} {...rest} />;
}
