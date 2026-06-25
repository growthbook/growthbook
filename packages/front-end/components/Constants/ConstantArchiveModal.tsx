import { useMemo, useState } from "react";
import { ConstantWithoutValue } from "shared/types/constant";
import { ConfigWithoutValue } from "shared/types/config";
import { Revision } from "shared/enterprise";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DraftMode } from "@/components/DraftSelector";
import ConstantDraftSelectorForChanges from "@/components/Constants/ConstantDraftSelectorForChanges";
import { ConstantRevisionContext } from "@/components/Constants/useConstantDraftTarget";
import ConstantReferencesList from "@/components/Constants/ConstantReferencesList";
import { useConstantReferences } from "@/hooks/useConstantReferences";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import LoadingSpinner from "@/components/LoadingSpinner";

// Archive/unarchive flows through the revision system (mirrors
// SavedGroupArchiveModal) via the draft selector.
export default function ConstantArchiveModal({
  constant,
  revisionCtx,
  onSaved,
  selectFlow,
  close,
  entity = "constants",
}: {
  constant: ConstantWithoutValue | ConfigWithoutValue;
  revisionCtx: ConstantRevisionContext;
  onSaved?: (revision: Revision) => void;
  selectFlow?: (revision: Revision | null) => void;
  close: () => void;
  // Base API path; "configs" routes the archive change through config endpoints.
  entity?: "constants" | "configs";
}) {
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();

  const noun = entity === "configs" ? "config" : "constant";
  const Noun = entity === "configs" ? "Config" : "Constant";

  const { openRevisions, allRevisions, approvalRequired, canBypassApproval } =
    revisionCtx;

  const isArchived = !!constant.archived;

  // A still-referenced constant can't be archived; unarchiving is always allowed.
  const { references, loading: referencesLoading } = useConstantReferences(
    isArchived ? null : constant.id,
    entity,
  );
  const totalReferences =
    (references?.features.length ?? 0) + (references?.constants.length ?? 0);
  const blockedByReferences = !isArchived && totalReferences > 0;
  const canSubmit = isArchived || (!referencesLoading && totalReferences === 0);

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
      header={isArchived ? `Unarchive ${Noun}` : `Archive ${Noun}`}
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
      ctaEnabled={canSubmit}
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
          `/${entity}/${constant.id}${qs ? `?${qs}` : ""}`,
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
          Are you sure you want to continue? This will make the {noun} active
          again.
        </p>
      ) : referencesLoading ? (
        <Text color="text-disabled">
          <LoadingSpinner /> Checking {noun} references...
        </Text>
      ) : blockedByReferences ? (
        <>
          <Callout status="error" mb="4">
            <Text as="p" weight="semibold" mb="2">
              Cannot archive {noun}
            </Text>
            <Text as="p" mb="0">
              Before you can archive this {noun}, you will need to remove any
              references to it. Check the following item
              {totalReferences > 1 ? "s" : ""} below:
            </Text>
          </Callout>
          <ConstantReferencesList
            features={references?.features ?? []}
            constants={references?.constants ?? []}
          />
        </>
      ) : (
        <p>Are you sure you want to continue? This will archive the {noun}.</p>
      )}
    </ModalStandard>
  );
}
