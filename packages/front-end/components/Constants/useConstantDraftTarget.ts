import { useState } from "react";
import { Revision } from "shared/enterprise";
import { DraftMode } from "@/components/DraftSelector";
import { useUser } from "@/services/UserContext";

const ACTIVE_DRAFT_STATUSES = new Set([
  "draft",
  "pending-review",
  "changes-requested",
  "approved",
]);

const isDraftRevision = (r: Revision) => ACTIVE_DRAFT_STATUSES.has(r.status);

// Revision context the edit modals need to render the draft selector and route
// the PUT correctly. Built once on the detail page and passed to each modal.
export type ConstantRevisionContext = {
  allRevisions: Revision[];
  openRevisions: Revision[];
  // The revision currently in view (null when viewing live).
  selectedRevision: Revision | null;
  approvalRequired: boolean;
  metadataReviewRequired: boolean;
  // Whether the current user can bypass approval for this constant.
  canBypassApproval: boolean;
};

// Owns the "new draft vs. add-to-existing vs. publish now" selection and turns
// it into PUT query params. Mirrors the saved-group form's logic.
export function useConstantDraftTarget(
  ctx: ConstantRevisionContext,
  // True when the form only edits metadata fields (info modal). Enables the
  // metadata-only shortcut: when the org requires approval but not metadata
  // review, the change can publish without admin bypass.
  isMetadataEdit: boolean,
) {
  const { userId } = useUser();
  const {
    openRevisions,
    selectedRevision,
    approvalRequired,
    metadataReviewRequired,
    canBypassApproval,
  } = ctx;

  const [draftSelectedId, setDraftSelectedId] = useState<string | null>(() => {
    if (selectedRevision && isDraftRevision(selectedRevision)) {
      return selectedRevision.id;
    }
    const myDraft = openRevisions.find(
      (r) => isDraftRevision(r) && r.authorId === userId,
    );
    return myDraft?.id ?? null;
  });

  // Metadata-only revision flow: approval on, metadata review off, metadata edit.
  const autoBypassApproval =
    isMetadataEdit && approvalRequired && !metadataReviewRequired;

  const [draftMode, setDraftMode] = useState<DraftMode>(() => {
    if (autoBypassApproval) return "new";
    return draftSelectedId ? "existing" : "new";
  });

  const canAutoPublish =
    !approvalRequired || canBypassApproval || autoBypassApproval;

  const buildQueryString = (): string => {
    const params = new URLSearchParams();
    if (draftMode === "publish") {
      // Admins bypass; the metadata-only shortcut uses autoPublish so non-admins
      // can still publish a metadata change the server allows.
      if (approvalRequired && !autoBypassApproval) {
        params.set("bypassApproval", "1");
      } else {
        params.set("autoPublish", "1");
      }
    } else if (draftMode === "existing" && draftSelectedId) {
      params.set("revisionId", draftSelectedId);
    } else {
      params.set("forceCreateRevision", "1");
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  return {
    draftMode,
    setDraftMode,
    draftSelectedId,
    setDraftSelectedId,
    canAutoPublish,
    // Passed to the selector: the metadata shortcut means "no approval gate here".
    selectorApprovalRequired: approvalRequired && !autoBypassApproval,
    metadataOnly: autoBypassApproval,
    buildQueryString,
  };
}
