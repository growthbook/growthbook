import { ReactNode, useState } from "react";
import { Revision } from "shared/enterprise";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import DraftSelector, { DraftMode } from "@/components/DraftSelector";
import RevisionDropdown from "@/components/Revision/RevisionDropdown";
import { useAuth } from "@/services/auth";

// Props the SDK connection page threads through to each edit modal so they can
// participate in the revision / approval flow (draft selector at the top +
// routing the PUT through the right revision params).
export type SdkConnectionRevisionProps = {
  onRevisionCreated?: (revision: Revision) => void;
  openRevisions?: Revision[];
  allRevisions?: Revision[];
  selectedRevision?: Revision | null;
  onSelectRevision?: (revision: Revision | null) => void;
  approvalRequired?: boolean;
  canAutoPublish?: boolean;
  metadataReviewRequired?: boolean;
};

/**
 * Encapsulates the SDK connection revision/approval flow shared by the
 * per-section edit modals. Returns a `DraftSelector` node to render at the top
 * of the modal and a `save` helper that PUTs with the correct revision params
 * and selects the newly-created revision — mirroring SDKConnectionForm.
 */
export function useSdkConnectionRevisionFlow({
  connection,
  mutate,
  onRevisionCreated,
  openRevisions,
  allRevisions,
  selectedRevision,
  onSelectRevision,
  approvalRequired,
  canAutoPublish,
  metadataReviewRequired,
}: {
  connection: SDKConnectionInterface;
  mutate: () => Promise<unknown> | void;
} & SdkConnectionRevisionProps): {
  revisionAware: boolean;
  draftSelector: ReactNode;
  save: (body: Record<string, unknown>) => Promise<void>;
} {
  const { apiCall } = useAuth();

  const revisionAware =
    !!connection.id &&
    (approvalRequired !== undefined || onRevisionCreated !== undefined);

  const [draftMode, setDraftMode] = useState<DraftMode>(() =>
    !approvalRequired ? "publish" : selectedRevision ? "existing" : "new",
  );
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(
    selectedRevision?.id ?? null,
  );

  const metadataOnlyRevisionFlow =
    !!approvalRequired && !metadataReviewRequired;

  const draftSelector =
    revisionAware && connection.id ? (
      <DraftSelector
        hasActiveDrafts={(openRevisions?.length ?? 0) > 0}
        mode={draftMode}
        setMode={setDraftMode}
        canAutoPublish={canAutoPublish ?? true}
        approvalRequired={!!approvalRequired}
        metadataOnly={metadataOnlyRevisionFlow}
        defaultExpanded={!canAutoPublish}
        revisionDropdown={
          <RevisionDropdown
            entityId={connection.id}
            allRevisions={allRevisions ?? []}
            selectedRevisionId={selectedDraftId}
            onSelectRevision={(rev) => setSelectedDraftId(rev?.id ?? null)}
            draftsOnly
            requiresApproval={false}
          />
        }
      />
    ) : null;

  const save = async (body: Record<string, unknown>) => {
    const params = new URLSearchParams();
    if (revisionAware) {
      if (draftMode === "publish") {
        params.set("autoPublish", "1");
        if (approvalRequired && canAutoPublish) {
          params.set("bypassApproval", "1");
        }
      } else if (draftMode === "existing" && selectedDraftId) {
        params.set("revisionId", selectedDraftId);
      } else {
        params.set("forceCreateRevision", "1");
      }
    }
    const queryString = params.toString();
    const url = `/sdk-connections/${connection.id}${
      queryString ? `?${queryString}` : ""
    }`;

    const res = await apiCall<{
      status: number;
      requiresApproval?: boolean;
      revision?: Revision;
    }>(url, {
      method: "PUT",
      body: JSON.stringify(body),
    });

    if (res?.revision) {
      onRevisionCreated?.(res.revision);
      if (draftMode === "new" || draftMode === "existing") {
        onSelectRevision?.(res.revision);
      }
    }
    await mutate();
  };

  return { revisionAware, draftSelector, save };
}
