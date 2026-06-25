import React, { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { ConstantInterface } from "shared/types/constant";
import {
  Revision,
  applyTopLevelPatchOps,
  getConstantRevisionChange,
} from "shared/enterprise";
import { constantRequiresReview, getReviewSetting } from "shared/util";
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
import Markdown from "@/components/Markdown/Markdown";
import ValueDisplay from "@/components/Features/ValueDisplay";
// eslint-disable-next-line no-restricted-imports
import Modal from "@/components/Modal";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Metadata from "@/ui/Metadata";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import RevisionDropdown from "@/components/Revision/RevisionDropdown";
import RevisionSummaryCard from "@/components/Revision/RevisionSummaryCard";
import RevisionDetail from "@/components/Revision/RevisionDetail";
import AuditHistoryExplorerModal from "@/components/AuditHistoryExplorer/AuditHistoryExplorerModal";
import { OVERFLOW_SECTION_LABEL } from "@/components/AuditHistoryExplorer/useAuditDiff";
import {
  REVISION_CONSTANT_DIFF_CONFIG,
  renderConstantSettings,
  renderConstantValues,
  getConstantSettingsBadges,
  getConstantValuesBadges,
} from "@/components/Constants/ConstantDiffRenders";
import {
  ConstantConflictModal,
  useConstantMergeResult,
} from "@/components/Constants/useConstantConflictModal";
import { useConstantRevision } from "@/hooks/useConstantRevision";
import ConstantModal from "@/components/Constants/ConstantModal";
import ConstantValueModal from "@/components/Constants/ConstantValueModal";
import ConstantArchiveModal from "@/components/Constants/ConstantArchiveModal";
import ConstantReferencesList from "@/components/Constants/ConstantReferencesList";
import CompareRevisionsModal from "@/components/Revision/CompareRevisionsModal";
import ReferencesLink from "@/components/References/ReferencesLink";
import { useConstantReferences } from "@/hooks/useConstantReferences";
import { ConstantRevisionContext } from "@/components/Constants/useConstantDraftTarget";

const TYPE_LABEL: Record<ConstantInterface["type"], string> = {
  string: "String",
  json: "JSON",
};

// Renders a constant value with the same formatter as feature flag values
// (JSON syntax highlighting, overflow-truncated with copy + fullscreen). Shows
// "(empty)" for an empty value so an intentional empty reads as such rather than
// looking like a render bug.
function ConstantValueDisplay({
  value,
  type,
}: {
  value: string | undefined;
  type: ConstantInterface["type"];
}) {
  if (!value) {
    return (
      <Text color="text-low">
        <em>(empty)</em>
      </Text>
    );
  }
  return (
    <ValueDisplay
      value={value}
      type={type}
      full
      showFullscreenButton
      fullscreenHeader="Constant Value"
    />
  );
}

export default function ConstantDetailPage(): React.ReactElement {
  const router = useRouter();
  const { cid } = router.query;
  // The detail-page route is addressed by the constant's `key` (immutable,
  // org-unique). Sub-resource calls below use the resolved `constant.id`.
  const constantKey = typeof cid === "string" ? cid : "";

  const { apiCall } = useAuth();
  const { projects, mutateDefinitions } = useDefinitions();
  const { organization, userId, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const [editInfoOpen, setEditInfoOpen] = useState(false);
  const [editValueOpen, setEditValueOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [showChangesModal, setShowChangesModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showReferencesModal, setShowReferencesModal] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, error, mutate } = useApi<{
    status: number;
    constant: ConstantInterface;
  }>(`/constants/${constantKey}`, { shouldRun: () => !!constantKey });
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

  const { references } = useConstantReferences(constant?.id);
  const totalReferences =
    (references?.features.length ?? 0) + (references?.constants.length ?? 0);

  const settings = organization.settings || {};
  const hasApprovalsFeature = hasCommercialFeature("require-approvals");

  // Constants inherit the feature `requireReviews` settings (drop-in for feature
  // config). Resolve the rule matching this constant's project for the coarse
  // "is approval configured" gate; the precise per-revision decision uses
  // `constantRequiresReview` below (mirroring the back-end adapter).
  const requireReviews = settings.requireReviews;
  const reviewRule =
    hasApprovalsFeature && Array.isArray(requireReviews)
      ? getReviewSetting(requireReviews, { project: constant?.project })
      : undefined;
  const approvalRequired =
    hasApprovalsFeature &&
    (requireReviews === true || !!reviewRule?.requireReviewOn);
  const metadataReviewRequired =
    approvalRequired &&
    (requireReviews === true
      ? true
      : (reviewRule?.featureRequireMetadataReview ?? true));

  const isDraft =
    !!selectedRevision &&
    (selectedRevision.status === "draft" ||
      selectedRevision.status === "pending-review" ||
      selectedRevision.status === "changes-requested" ||
      selectedRevision.status === "approved");

  // Precise per-revision gate, mirroring the server-side constant adapter: a
  // value change always requires review (all environments), a per-env override
  // only when its environment is in scope, metadata per the rule's toggle.
  const selectedRevisionRequiresApproval =
    !!selectedRevision &&
    hasApprovalsFeature &&
    constantRequiresReview(
      {
        project: (selectedRevision.target.snapshot as ConstantInterface)
          .project,
      },
      getConstantRevisionChange(
        selectedRevision.target.snapshot as ConstantInterface,
        selectedRevision.target.proposedChanges,
      ),
      settings,
    );

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

  // Whether the user can bypass approval for this constant (its project, or the
  // global "" project when unscoped) — enables the "publish now" option.
  const canBypassApproval = permissionsUtil.canBypassApprovalChecks({
    project: constant.project || "",
  });

  const revisionCtx: ConstantRevisionContext = {
    allRevisions,
    openRevisions,
    selectedRevision,
    approvalRequired,
    metadataReviewRequired,
    canBypassApproval,
  };

  const projectName = displayedConstant.project
    ? (projects.find((proj) => proj.id === displayedConstant.project)?.name ??
      displayedConstant.project)
    : "";

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
              <DropdownMenuGroup>
                {canEditNow && (
                  <DropdownMenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      setEditInfoOpen(true);
                    }}
                  >
                    Edit information
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    setShowAuditModal(true);
                  }}
                >
                  Audit history
                </DropdownMenuItem>
              </DropdownMenuGroup>
              {(canEditNow || canDeleteNow) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
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
                  </DropdownMenuGroup>
                </>
              )}
            </DropdownMenu>
          </Flex>
        </Flex>

        <Flex align="center" gap="4" mb="4" wrap="wrap" justify="between">
          <Flex gap="4" align="center" wrap="wrap">
            <Metadata label="Key" value={constant.key} />
            <Metadata label="Type" value={TYPE_LABEL[constant.type]} />
            <Metadata label="Project" value={projectName || "All projects"} />
            <Box>
              <Text weight="medium">Owner: </Text>
              <Owner ownerId={displayedConstant.owner} gap="1" />
            </Box>
          </Flex>
          <Flex direction="column" align="end" gap="2">
            <ReferencesLink
              total={totalReferences}
              onShow={() => setShowReferencesModal(true)}
              emptyTooltip="No features or constants currently reference this constant."
            />
          </Flex>
        </Flex>

        {displayedConstant.description && (
          <Box mb="3">
            <Markdown>{displayedConstant.description}</Markdown>
          </Box>
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
          onCompare={() => setCompareOpen(true)}
          onFixConflicts={() => setConflictOpen(true)}
          onReviewPublish={() => setShowChangesModal(true)}
        />

        <Frame mb="4" px="6" py="5">
          <Flex justify="between" align="center" gap="3" mb="3">
            <Heading size="medium" as="h2" mb="0">
              Value
            </Heading>
            {canEditNow && (
              <Button variant="ghost" onClick={() => setEditValueOpen(true)}>
                Edit
              </Button>
            )}
          </Flex>
          <ConstantValueDisplay
            value={displayedConstant.value}
            type={displayedConstant.type}
          />

          {Object.keys(displayedConstant.environmentValues || {}).length >
            0 && (
            <>
              <Heading size="medium" as="h2" mt="6" mb="3">
                Environment overrides
              </Heading>
              <Flex direction="column" gap="5">
                {Object.entries(displayedConstant.environmentValues || {}).map(
                  ([env, value]) => (
                    <Box key={env}>
                      <Text as="div" size="large" weight="semibold" mb="2">
                        {env}
                      </Text>
                      <ConstantValueDisplay
                        value={value}
                        type={displayedConstant.type}
                      />
                    </Box>
                  ),
                )}
              </Flex>
            </>
          )}
        </Frame>
      </div>

      {showChangesModal && selectedRevision && (
        <Modal
          header={selectedRevision.title || "Revision"}
          trackingEventModalType="constant-revision-changes"
          close={() => setShowChangesModal(false)}
          open={showChangesModal}
          dismissible
          size="max"
          hideCta={true}
          closeCta="Close"
          useRadixButton={true}
        >
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
            canUpdateEntity={(s) => permissionsUtil.canUpdateConstant(s, {})}
          />
        </Modal>
      )}

      {showReferencesModal && references && (
        <Modal
          header={`'${displayedConstant.name}' References`}
          trackingEventModalType="show-constant-references"
          close={() => setShowReferencesModal(false)}
          open={showReferencesModal}
          closeCta="Close"
          useRadixButton={true}
        >
          <Text as="p" mb="3">
            This constant is referenced by the following features and constants
            via <code>@const:{constant.key}</code>.
          </Text>
          <ConstantReferencesList
            features={references.features}
            constants={references.constants}
          />
        </Modal>
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

      {compareOpen && (
        <CompareRevisionsModal
          liveEntity={constant}
          entityId={constant.id}
          diffConfig={REVISION_CONSTANT_DIFF_CONFIG}
          allRevisions={allRevisions}
          currentRevisionId={selectedRevisionId}
          onClose={() => setCompareOpen(false)}
          mutate={async () => {
            await Promise.all([mutateRevisions(), mutate()]);
          }}
          requiresApproval={approvalRequired}
        />
      )}

      {showAuditModal && (
        <AuditHistoryExplorerModal<ConstantInterface>
          entityId={constant.id}
          entityName="Constant"
          config={{
            entityType: "constant",
            includedEvents: ["constant.created", "constant.updated"],
            alwaysVisibleEvents: ["constant.created"],
            labelOnlyEvents: [
              {
                event: "constant.deleted",
                getLabel: () => "Deleted",
                alwaysVisible: true,
              },
            ],
            sections: [
              {
                label: "Settings",
                keys: ["name", "owner", "description", "project", "archived"],
                render: renderConstantSettings,
                getBadges: getConstantSettingsBadges,
              },
              {
                label: "Value",
                keys: ["value", "environmentValues"],
                render: renderConstantValues,
                getBadges: getConstantValuesBadges,
              },
            ],
            updateEventNames: ["constant.updated"],
            defaultGroupBy: "minute",
            hideFilters: true,
            hiddenLabelSections: [OVERFLOW_SECTION_LABEL],
          }}
          onClose={() => setShowAuditModal(false)}
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
