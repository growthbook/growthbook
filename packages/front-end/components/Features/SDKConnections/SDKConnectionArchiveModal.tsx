import { useMemo, useState } from "react";
import { Revision, getSdkConnectionApprovalRule } from "shared/enterprise";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DraftSelector, { DraftMode } from "@/components/DraftSelector";
import RevisionDropdown from "@/components/Revision/RevisionDropdown";

interface SDKConnectionArchiveModalProps {
  connection: SDKConnectionInterface;
  close: () => void;
  openRevisions: Revision[];
  allRevisions: Revision[];
  mutate: () => void;
  onRevisionCreated?: (revision: Revision) => void;
  selectFlow?: (revision: Revision | null) => void;
}

export default function SDKConnectionArchiveModal({
  connection,
  close,
  openRevisions,
  allRevisions,
  mutate,
  onRevisionCreated,
  selectFlow,
}: SDKConnectionArchiveModalProps) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature } = useUser();

  const isArchived = connection.archived;

  const canBypass = connection.projects?.length
    ? connection.projects.every((p) =>
        permissionsUtil.canBypassApprovalChecks({ project: p || "" }),
      )
    : permissionsUtil.canBypassApprovalChecks({ project: "" });

  const matchedRule = hasCommercialFeature("require-approvals")
    ? getSdkConnectionApprovalRule(settings.approvalFlows, {
        projects: connection.projects,
        environment: connection.environment,
      })
    : undefined;
  const approvalRequired = !!matchedRule;

  // Archive/unarchive always requires review when approval flows are enabled
  const archiveGated = approvalRequired;

  const canAutoPublish = canBypass || !archiveGated;

  const [mode, setMode] = useState<DraftMode>(archiveGated ? "new" : "publish");
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(
    openRevisions[0]?.id ?? null,
  );

  const isDraftRevision = (r: Revision) =>
    ["draft", "pending-review", "changes-requested", "approved"].includes(
      r.status,
    );
  const activeDrafts = useMemo(
    () => openRevisions.filter(isDraftRevision),
    [openRevisions],
  );
  const selectedDraftRevision = useMemo(
    () =>
      selectedDraftId
        ? (allRevisions.find((r) => r.id === selectedDraftId) ?? null)
        : null,
    [selectedDraftId, allRevisions],
  );
  const existingDraftLabel = selectedDraftRevision
    ? selectedDraftRevision.title ||
      `Revision ${
        allRevisions.filter(
          (r) =>
            new Date(r.dateCreated) <=
            new Date(selectedDraftRevision.dateCreated),
        ).length
      }`
    : null;

  return (
    <Modal
      trackingEventModalType=""
      header={
        isArchived ? "Unarchive SDK Connection" : "Archive SDK Connection"
      }
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
          // Archive/unarchive still flows through the revision system so it
          // shows up in history. When approval is required but the caller has
          // bypass permission, record it as a bypass; otherwise auto-merge.
          if (archiveGated && canBypass) {
            params.set("bypassApproval", "1");
          } else {
            params.set("autoPublish", "1");
          }
        } else if (mode === "existing" && selectedDraftId) {
          params.set("revisionId", selectedDraftId);
        } else {
          // mode === "new"
          params.set("forceCreateRevision", "1");
        }

        const url = `/sdk-connections/${connection.id}${params.toString() ? `?${params.toString()}` : ""}`;

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
      useRadixButton={true}
    >
      <DraftSelector
        hasActiveDrafts={activeDrafts.length > 0}
        mode={mode}
        setMode={setMode}
        canAutoPublish={canAutoPublish}
        approvalRequired={archiveGated}
        existingDraftLabel={existingDraftLabel}
        revisionDropdown={
          <RevisionDropdown
            entityId={connection.id}
            allRevisions={allRevisions}
            selectedRevisionId={selectedDraftId}
            onSelectRevision={(rev) => setSelectedDraftId(rev?.id ?? null)}
            draftsOnly
            requiresApproval={false}
          />
        }
      />
      {isArchived ? (
        <p>
          Are you sure you want to continue? This will make the SDK connection
          active again.
        </p>
      ) : (
        <p>
          Are you sure you want to continue? This will make the SDK connection
          inactive and it will no longer serve feature flags to your
          application.
        </p>
      )}
    </Modal>
  );
}
