import { useMemo, useState } from "react";
import { ConstantWithoutValue } from "shared/types/constant";
import { Revision } from "shared/enterprise";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DraftMode } from "@/components/DraftSelector";
import ConstantDraftSelectorForChanges from "@/components/Constants/ConstantDraftSelectorForChanges";
import { ConstantRevisionContext } from "@/components/Constants/useConstantDraftTarget";
import Callout from "@/ui/Callout";

// Archive/unarchive a constant. Mirrors SavedGroupArchiveModal: the change
// flows through the revision system (so it shows up in history) via the draft
// selector — create a new draft, add to an existing one, or publish now.
export default function ConstantArchiveModal({
  constant,
  revisionCtx,
  onSaved,
  selectFlow,
  close,
}: {
  constant: ConstantWithoutValue;
  revisionCtx: ConstantRevisionContext;
  onSaved?: (revision: Revision) => void;
  selectFlow?: (revision: Revision | null) => void;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();

  const { openRevisions, allRevisions, approvalRequired, canBypassApproval } =
    revisionCtx;

  const isArchived = !!constant.archived;

  // Archive/unarchive always requires review when approval flows are enabled.
  const archiveGated = approvalRequired;
  const canAutoPublish = canBypassApproval || !archiveGated;

  const isDraftRevision = (r: Revision) =>
    ["draft", "pending-review", "changes-requested", "approved"].includes(
      r.status,
    );
  const activeDrafts = useMemo(
    () => openRevisions.filter(isDraftRevision),
    [openRevisions],
  );

  const [mode, setMode] = useState<DraftMode>(archiveGated ? "new" : "publish");
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(
    activeDrafts[0]?.id ?? null,
  );

  return (
    <ModalStandard
      open={true}
      trackingEventModalType="constant-archive-modal"
      header={isArchived ? "Unarchive Constant" : "Archive Constant"}
      size="lg"
      close={close}
      cta={
        mode === "publish"
          ? isArchived
            ? "Unarchive"
            : "Archive"
          : "Save to draft"
      }
      ctaColor={mode === "publish" ? "red" : "violet"}
      submit={async () => {
        const desiredArchived = !isArchived;
        const params = new URLSearchParams();

        if (mode === "publish") {
          // Record an admin bypass when approval is required; otherwise merge.
          if (archiveGated && canBypassApproval) {
            params.set("bypassApproval", "1");
          } else {
            params.set("autoPublish", "1");
          }
        } else if (mode === "existing" && selectedDraftId) {
          params.set("revisionId", selectedDraftId);
        } else {
          params.set("forceCreateRevision", "1");
        }

        const qs = params.toString();
        const res = await apiCall<{ revision?: Revision }>(
          `/constants/${constant.id}${qs ? `?${qs}` : ""}`,
          {
            method: "PUT",
            body: JSON.stringify({ archived: desiredArchived }),
          },
        );

        if (res?.revision) {
          onSaved?.(res.revision);
          if (mode === "new" || mode === "existing") {
            selectFlow?.(res.revision);
          }
        }
        await mutateDefinitions();
      }}
    >
      <ConstantDraftSelectorForChanges
        constantId={constant.id}
        openRevisions={openRevisions}
        allRevisions={allRevisions}
        mode={mode}
        setMode={setMode}
        selectedDraftId={selectedDraftId}
        setSelectedDraftId={setSelectedDraftId}
        canAutoPublish={canAutoPublish}
        approvalRequired={archiveGated}
      />
      {isArchived ? (
        <p>
          Are you sure you want to continue? This will make the constant active
          again.
        </p>
      ) : (
        <>
          <p>
            Are you sure you want to continue? This will archive the constant.
          </p>
          <Callout status="warning">
            Archived constants are stripped from any feature values in the SDK
            payload — references to this constant (
            <code>{`{{ @const:${constant.key} }}`}</code> and{" "}
            <code>{`{ "@const:${constant.key}": true }`}</code>) will be removed
            rather than resolved.
          </Callout>
        </>
      )}
    </ModalStandard>
  );
}
