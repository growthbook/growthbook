import { SavedGroupInterface } from "shared/types/saved-group";
import { useState } from "react";
import { Revision } from "shared/enterprise";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useSavedGroupReferences } from "@/hooks/useSavedGroupReferences";
import SavedGroupReferencesList from "./SavedGroupReferencesList";
import SavedGroupDraftSelector from "./SavedGroupDraftSelector";

export type DraftMode = "existing" | "new" | "publish";

interface SavedGroupArchiveModalProps {
  savedGroup: SavedGroupInterface;
  close: () => void;
  openRevisions: Revision[];
  allRevisions: Revision[];
  mutate: () => void;
  onRevisionCreated?: (revision: Revision) => void;
  selectFlow?: (revision: Revision | null) => void;
}

export default function SavedGroupArchiveModal({
  savedGroup,
  close,
  openRevisions,
  allRevisions,
  mutate,
  onRevisionCreated,
  selectFlow,
}: SavedGroupArchiveModalProps) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();

  const { references, loading } = useSavedGroupReferences(savedGroup.id);
  const totalReferences =
    (references?.features.length ?? 0) +
    (references?.experiments.length ?? 0) +
    (references?.savedGroups.length ?? 0);

  const isArchived = savedGroup.archived;

  const canBypass =
    savedGroup.projects && savedGroup.projects.length > 0
      ? savedGroup.projects.every((proj) =>
          permissionsUtil.canBypassApprovalChecks({ project: proj || "" }),
        )
      : permissionsUtil.canBypassApprovalChecks({ project: "" });

  const approvalRequired =
    settings.approvalFlows?.savedGroups?.required ?? false;

  // Archive/unarchive always requires review when approval flows are enabled
  const archiveGated = approvalRequired;

  const canAutoPublish = canBypass || !archiveGated;

  const [mode, setMode] = useState<DraftMode>(archiveGated ? "new" : "publish");
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(
    openRevisions[0]?.id ?? null,
  );

  const canSubmit = !loading && totalReferences === 0;

  return (
    <Modal
      trackingEventModalType=""
      header={isArchived ? "Unarchive Saved Group" : "Archive Saved Group"}
      size="lg"
      close={close}
      open={true}
      cta={
        mode === "publish"
          ? isArchived
            ? "Unarchive"
            : "Archive"
          : "Save to draft"
      }
      submitColor={mode === "publish" ? "danger" : "primary"}
      submit={async () => {
        const desiredArchived = !isArchived;
        const params = new URLSearchParams();

        if (mode === "publish") {
          // Direct update without revision workflow
          // Don't set revisionId or forceCreateRevision
        } else if (mode === "existing" && selectedDraftId) {
          params.set("revisionId", selectedDraftId);
        } else {
          // mode === "new"
          params.set("forceCreateRevision", "1");
        }

        const url = `/saved-groups/${savedGroup.id}${params.toString() ? `?${params.toString()}` : ""}`;

        const res = await apiCall<{
          status: number;
          requiresApproval?: boolean;
          revision?: Revision;
        }>(url, {
          method: "PUT",
          body: JSON.stringify({ archived: desiredArchived }),
        });

        if (res?.revision) {
          onRevisionCreated?.(res.revision);
          if (mode === "new" || mode === "existing") {
            selectFlow?.(res.revision);
          }
        }
        mutate();
        close();
      }}
      ctaEnabled={canSubmit}
      useRadixButton={true}
    >
      <SavedGroupDraftSelector
        savedGroup={savedGroup}
        openRevisions={openRevisions}
        allRevisions={allRevisions}
        mode={mode}
        setMode={setMode}
        selectedDraftId={selectedDraftId}
        setSelectedDraftId={setSelectedDraftId}
        canAutoPublish={canAutoPublish}
        approvalRequired={archiveGated}
      />
      {loading ? (
        <Text color="text-disabled">
          <LoadingSpinner /> Checking saved group references...
        </Text>
      ) : totalReferences > 0 ? (
        <>
          <Callout status="error" mb="4">
            <Text as="p" weight="semibold" mb="2">
              Cannot {isArchived ? "unarchive" : "archive"} saved group
            </Text>
            <Text as="p" mb="0">
              Before you can {isArchived ? "unarchive" : "archive"} this saved
              group, you will need to remove any references to it. Check the
              following item
              {totalReferences > 1 && "s"} below:
            </Text>
          </Callout>
          <SavedGroupReferencesList
            features={references?.features ?? []}
            experiments={references?.experiments ?? []}
            savedGroups={references?.savedGroups ?? []}
          />
        </>
      ) : isArchived ? (
        <p>
          Are you sure you want to continue? This will make the saved group
          active again.
        </p>
      ) : (
        <p>
          Are you sure you want to continue? This will make the saved group
          inactive and it will no longer be usable in features and experiments.
        </p>
      )}
    </Modal>
  );
}
