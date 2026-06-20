import React, { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { ConstantInterface } from "shared/types/constant";
import {
  Revision,
  applyTopLevelPatchOps,
  isConstantRevisionMetadataOnly,
} from "shared/enterprise";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import Owner from "@/components/Avatar/Owner";
import Modal from "@/ui/Modal";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Metadata from "@/ui/Metadata";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import RevisionDropdown from "@/components/Revision/RevisionDropdown";
import RevisionSummaryCard from "@/components/Revision/RevisionSummaryCard";
import RevisionDetail from "@/components/Revision/RevisionDetail";
import { REVISION_CONSTANT_DIFF_CONFIG } from "@/components/Constants/ConstantDiffRenders";
import {
  ConstantConflictModal,
  useConstantMergeResult,
} from "@/components/Constants/useConstantConflictModal";
import { useConstantRevision } from "@/hooks/useConstantRevision";
import ConstantModal from "@/components/Constants/ConstantModal";
import ConstantValueModal from "@/components/Constants/ConstantValueModal";
import ConstantArchiveModal from "@/components/Constants/ConstantArchiveModal";
import { ConstantRevisionContext } from "@/components/Constants/useConstantDraftTarget";

const TYPE_LABEL: Record<ConstantInterface["type"], string> = {
  string: "String",
  json: "JSON",
};

function ValueBlock({ label, value }: { label: string; value: string }) {
  return (
    <Box mb="2">
      <Text as="div" size="small" color="text-mid" mb="1">
        {label}
      </Text>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          margin: 0,
          padding: "var(--space-2)",
          background: "var(--gray-a2)",
          borderRadius: "var(--radius-2)",
        }}
      >
        {value}
      </pre>
    </Box>
  );
}

export default function ConstantDetailPage(): React.ReactElement {
  const router = useRouter();
  const { cid } = router.query;
  const constantId = typeof cid === "string" ? cid : "";

  const { apiCall } = useAuth();
  const { projects, mutateDefinitions } = useDefinitions();
  const { organization, userId } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const [editInfoOpen, setEditInfoOpen] = useState(false);
  const [editValueOpen, setEditValueOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [showChangesModal, setShowChangesModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, error, mutate } = useApi<{
    status: number;
    constant: ConstantInterface;
  }>(`/constants/${constantId}`, { shouldRun: () => !!constantId });
  const constant = data?.constant;

  const {
    selectedRevision,
    selectedRevisionId,
    openRevisions,
    allRevisions,
    selectRevision,
    onRevisionCreated,
    handlePublish,
    handleDiscard,
    handleReopen,
    mutateRevisions,
  } = useConstantRevision(constant?.id, mutate, constant);

  const settings = organization.settings || {};
  const approvalRequired =
    settings.approvalFlows?.constants?.[0]?.required ?? false;
  const metadataReviewRequired =
    approvalRequired &&
    (settings.approvalFlows?.constants?.[0]?.requireMetadataReview ?? true);

  const isDraft =
    !!selectedRevision &&
    (selectedRevision.status === "draft" ||
      selectedRevision.status === "pending-review" ||
      selectedRevision.status === "changes-requested" ||
      selectedRevision.status === "approved");

  // Per-revision approval gate: a metadata-only revision skips review when
  // `requireMetadataReview` is off. Mirrors the server-side constant adapter.
  const selectedRevisionRequiresApproval =
    !!selectedRevision &&
    approvalRequired &&
    (metadataReviewRequired ||
      !isConstantRevisionMetadataOnly(selectedRevision.target.proposedChanges));

  // Show the selected revision's proposed state when one is selected.
  const displayedConstant = useMemo(() => {
    if (!selectedRevision) return constant;
    return applyTopLevelPatchOps(
      selectedRevision.target.snapshot as ConstantInterface,
      selectedRevision.target.proposedChanges,
    ) as ConstantInterface;
  }, [selectedRevision, constant]);

  const mergeResult = useConstantMergeResult(
    constant,
    selectedRevision,
    isDraft,
  );

  if (error) {
    return (
      <div className="container-fluid pagecontents">
        <Callout status="error">{error.message}</Callout>
      </div>
    );
  }
  if (!constant || !displayedConstant) {
    return <LoadingOverlay />;
  }

  // Explicitly start an empty draft to work in (forceCreateRevision creates one
  // regardless of approval settings). The user then edits value/info on it.
  const handleNewDraft = async () => {
    const res = await apiCall<{ revision?: Revision }>(
      `/constants/${constant.id}?forceCreateRevision=1`,
      { method: "PUT", body: JSON.stringify({}) },
    );
    if (res?.revision) await onRevisionCreated(res.revision);
  };

  const canUpdate = permissionsUtil.canUpdateConstant(constant, constant);
  // Delete is gated on the LIVE archive state (not the displayed/draft state):
  // the constant must be archived and published before it can be deleted.
  const canDeleteNow =
    permissionsUtil.canDeleteConstant(constant) && !!constant.archived;
  // Editing is only meaningful on the live state or a draft (not when viewing a
  // merged/discarded revision). On live it starts a new draft; on a draft it
  // updates it.
  const canEditNow = canUpdate && (!selectedRevision || isDraft);

  // Whether the user can bypass approval for this constant (every project, or
  // the global "" project when unscoped) — enables the "publish now" option.
  const canBypassApproval = (
    constant.projects?.length ? constant.projects : [""]
  ).every((project) => permissionsUtil.canBypassApprovalChecks({ project }));

  const revisionCtx: ConstantRevisionContext = {
    allRevisions,
    openRevisions,
    selectedRevision,
    approvalRequired,
    metadataReviewRequired,
    canBypassApproval,
  };

  const projectNames = (displayedConstant.projects || [])
    .map((p) => projects.find((proj) => proj.id === p)?.name || p)
    .join(", ");

  return (
    <>
      <PageHead
        breadcrumb={[
          { display: "Constants", href: "/constants" },
          { display: displayedConstant.name },
        ]}
      />
      <div className="container-fluid pagecontents">
        <Flex align="start" justify="between" gap="2" mb="2">
          <Flex align="center" gap="3" style={{ marginTop: "-4px" }}>
            <Heading size="2x-large" as="h1" mb="0">
              {displayedConstant.name}
            </Heading>
            {displayedConstant.archived && (
              <Badge label="Archived" color="gray" />
            )}
          </Flex>
          <Flex align="center" gap="4" pr="2">
            <RevisionDropdown
              entityId={constant.id}
              allRevisions={allRevisions}
              selectedRevisionId={selectedRevisionId}
              onSelectRevision={selectRevision}
              requiresApproval={approvalRequired}
              context="header"
            />
            {(canEditNow || canDeleteNow) && (
              <DropdownMenu
                trigger={
                  <IconButton
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="2"
                    highContrast
                  >
                    <BsThreeDotsVertical size={16} />
                  </IconButton>
                }
                open={menuOpen}
                onOpenChange={setMenuOpen}
                menuPlacement="end"
              >
                {canEditNow && (
                  <DropdownMenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      setEditInfoOpen(true);
                    }}
                  >
                    Edit info
                  </DropdownMenuItem>
                )}
                {canEditNow && (
                  <DropdownMenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      setShowArchiveModal(true);
                    }}
                  >
                    {displayedConstant.archived ? "Unarchive" : "Archive"}
                  </DropdownMenuItem>
                )}
                {canDeleteNow && (
                  <DropdownMenuItem
                    color="red"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDelete(true);
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenu>
            )}
          </Flex>
        </Flex>

        <Flex align="center" gap="4" mb="4" wrap="wrap">
          <Metadata label="Key" value={constant.key} />
          <Metadata label="Type" value={TYPE_LABEL[constant.type]} />
          <Metadata label="Projects" value={projectNames || "All projects"} />
          <Box>
            <Text weight="medium">Owner: </Text>
            <Owner ownerId={displayedConstant.owner} gap="1" />
          </Box>
        </Flex>

        {displayedConstant.description && (
          <Text as="p" mb="3">
            {displayedConstant.description}
          </Text>
        )}

        <RevisionSummaryCard
          allRevisions={allRevisions}
          selectedRevision={selectedRevision}
          entityNoun="constant"
          hasRevisions={allRevisions.length > 0}
          metadataReviewRequired={metadataReviewRequired}
          requiresApproval={selectedRevisionRequiresApproval}
          mergeResult={mergeResult}
          currentUserId={userId}
          fallbackOwnerId={constant.owner}
          fallbackDateCreated={constant.dateCreated}
          onSelectRevision={selectRevision}
          onTitleCommit={async (revisionId, title) => {
            await apiCall(`/revision/${revisionId}/title`, {
              method: "PATCH",
              body: JSON.stringify({ title }),
            });
            await mutateRevisions();
          }}
          onReopen={async (revisionId) => {
            await handleReopen(revisionId);
          }}
          onDiscard={async (revisionId) => {
            await handleDiscard(revisionId);
          }}
          onNewDraft={canUpdate ? handleNewDraft : undefined}
          onFixConflicts={() => setConflictOpen(true)}
          onReviewPublish={() => setShowChangesModal(true)}
        />

        <Heading size="medium" as="h2" mb="3">
          Value
        </Heading>
        <Frame mb="4" px="6" py="5">
          <Flex justify="between" align="start" gap="3">
            <Box style={{ flex: 1, minWidth: 0 }}>
              {displayedConstant.value && (
                <ValueBlock label="Value" value={displayedConstant.value} />
              )}
              {Object.entries(displayedConstant.environmentValues || {}).map(
                ([env, value]) => (
                  <ValueBlock
                    key={env}
                    label={`Override: ${env}`}
                    value={value}
                  />
                ),
              )}
            </Box>
            {canEditNow && (
              <Button variant="ghost" onClick={() => setEditValueOpen(true)}>
                Edit
              </Button>
            )}
          </Flex>
        </Frame>
      </div>

      {showChangesModal && selectedRevision && (
        <Modal.Root
          open={showChangesModal}
          onOpenChange={(o) => !o && setShowChangesModal(false)}
          size="lg"
          dismissible
          trackingEventModalType="constant-revision-changes"
        >
          <Modal.Header>
            <Modal.Title>{selectedRevision.title || "Revision"}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <RevisionDetail<ConstantInterface>
              diffConfig={REVISION_CONSTANT_DIFF_CONFIG}
              revision={selectedRevision}
              currentState={constant}
              mutate={async () => {
                await Promise.all([mutateRevisions(), mutate()]);
              }}
              setCurrentRevision={(r) => selectRevision(r)}
              onPublish={async (revisionId) => {
                await handlePublish(revisionId);
              }}
              onReopen={async (revisionId) => {
                await handleReopen(revisionId);
              }}
              allRevisions={allRevisions}
              requiresApproval={selectedRevisionRequiresApproval}
              closeModal={() => setShowChangesModal(false)}
            />
          </Modal.Body>
        </Modal.Root>
      )}

      {editInfoOpen && (
        <ConstantModal
          existing={displayedConstant}
          revisionCtx={revisionCtx}
          onSaved={async (revision) => {
            await onRevisionCreated(revision);
          }}
          close={() => setEditInfoOpen(false)}
        />
      )}

      {editValueOpen && (
        <ConstantValueModal
          existing={displayedConstant}
          full={displayedConstant}
          revisionCtx={revisionCtx}
          onSaved={async (revision) => {
            await onRevisionCreated(revision);
          }}
          close={() => setEditValueOpen(false)}
        />
      )}

      {showArchiveModal && (
        <ConstantArchiveModal
          constant={displayedConstant}
          revisionCtx={revisionCtx}
          onSaved={onRevisionCreated}
          selectFlow={selectRevision}
          close={() => setShowArchiveModal(false)}
        />
      )}

      {conflictOpen && selectedRevision && (
        <ConstantConflictModal
          constant={constant}
          selectedRevision={selectedRevision}
          close={() => setConflictOpen(false)}
          mutate={async () => {
            await Promise.all([mutateRevisions(), mutate()]);
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${constant.name}"?`}
          content="This permanently deletes the constant. This cannot be undone."
          yesText="Delete"
          onConfirm={async () => {
            await apiCall(`/constants/${constant.id}`, { method: "DELETE" });
            await mutateDefinitions();
            router.push("/constants");
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
