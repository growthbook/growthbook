import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { useRouter } from "next/router";
import { SavedGroupInterface } from "shared/types/saved-group";
import { Revision } from "shared/enterprise";
import { ago, datetime } from "shared/dates";
import { FaPlusCircle } from "react-icons/fa";
import {
  PiArrowsDownUp,
  PiPencil,
  PiProhibit,
  PiLockSimple,
  PiPencilSimpleFill,
  PiArrowsLeftRightBold,
} from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { isIdListSupportedAttribute } from "shared/util";
import { Box, Card, Flex, IconButton, Separator } from "@radix-ui/themes";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";
import PageHead from "@/components/Layout/PageHead";
import Pagination from "@/components/Pagination";
import Frame from "@/ui/Frame";
import Metadata from "@/ui/Metadata";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import SavedGroupForm from "@/components/SavedGroups/SavedGroupForm";
import SavedGroupArchiveModal from "@/components/SavedGroups/SavedGroupArchiveModal";
import {
  SavedGroupConflictModal,
  useSavedGroupMergeResult,
} from "@/components/SavedGroups/useSavedGroupConflictModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Modal from "@/components/Modal";
import LoadingOverlay from "@/components/LoadingOverlay";
import { IdListItemInput } from "@/components/SavedGroups/IdListItemInput";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import LargeSavedGroupPerformanceWarning, {
  useLargeSavedGroupSupport,
} from "@/components/SavedGroups/LargeSavedGroupSupportWarning";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import AuditHistoryExplorerModal from "@/components/AuditHistoryExplorer/AuditHistoryExplorerModal";
import { OVERFLOW_SECTION_LABEL } from "@/components/AuditHistoryExplorer/useAuditDiff";
import {
  renderSavedGroupTargeting,
  renderSavedGroupProjects,
  renderSavedGroupSettings,
  getSavedGroupSettingsBadges,
  getSavedGroupTargetingBadges,
  getSavedGroupValuesBadges,
  getSavedGroupProjectsBadges,
} from "@/components/SavedGroups/SavedGroupDiffRenders";
import { DocLink } from "@/components/DocLink";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import SavedGroupReferences from "@/components/SavedGroups/SavedGroupReferences";
import SavedGroupReferencesList from "@/components/SavedGroups/SavedGroupReferencesList";
import Checkbox from "@/ui/Checkbox";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import RevisionDetail from "@/components/Revision/RevisionDetail";
import SavedGroupRevisionDropdown from "@/components/SavedGroups/SavedGroupRevisionDropdown";
import CompareSavedGroupRevisionsModal from "@/components/SavedGroups/CompareSavedGroupRevisionsModal";
import { useSavedGroupRevision } from "@/hooks/useSavedGroupRevision";
import { useSavedGroupReferences } from "@/hooks/useSavedGroupReferences";
import { REVISION_SAVED_GROUP_DIFF_CONFIG } from "@/components/Revision/RevisionDiffConfig";
import { useUser } from "@/services/UserContext";
import UserAvatar from "@/components/Avatar/UserAvatar";
import { useScrollPosition } from "@/hooks/useScrollPosition";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";

const NUM_PER_PAGE = 10;

export default function EditSavedGroupPage() {
  const router = useRouter();
  const { sgid } = router.query;
  const { data, error, mutate } = useApi<{ savedGroup: SavedGroupInterface }>(
    `/saved-groups/${sgid}`,
  );
  const savedGroup = data?.savedGroup;
  const [sortNewestFirst, setSortNewestFirst] = useState<boolean>(true);
  const [addItems, setAddItems] = useState<boolean>(false);
  const [itemsToAdd, setItemsToAdd] = useState<string[]>([]);
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const [showReferencesModal, setShowReferencesModal] =
    useState<boolean>(false);
  const [showAuditModal, setShowAuditModal] = useState<boolean>(false);
  const [showChangesModal, setShowChangesModal] = useState<boolean>(false);
  const [compareRevisionsModalOpen, setCompareRevisionsModalOpen] =
    useState<boolean>(false);
  const [conflictModal, setConflictModal] = useState<boolean>(false);
  const [confirmNewDraft, setConfirmNewDraft] = useState<boolean>(false);
  const [newDraftTitle, setNewDraftTitle] = useState("");
  const [newDraftTitleStash, setNewDraftTitleStash] = useState("");
  const [editingNewDraftTitle, setEditingNewDraftTitle] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const [adminBypassSizeLimit, setAdminBypassSizeLimit] = useState(false);
  const [isCreatingNewRevision, setIsCreatingNewRevision] =
    useState<boolean>(false);
  const [confirmRevert, setConfirmRevert] = useState<boolean>(false);
  const [revisionToRevert, setRevisionToRevert] = useState<Revision | null>(
    null,
  );

  const bannerRef = useRef<HTMLDivElement>(null);
  const [bannerPinned, setBannerPinned] = useState(false);
  const { scrollY } = useScrollPosition();

  useEffect(() => {
    if (!bannerRef.current) return;
    setBannerPinned(bannerRef.current.getBoundingClientRect().top <= 110);
  }, [scrollY]);

  const settings = useOrgSettings();
  const { savedGroupSizeLimit, attributeSchema } = settings;

  const { references } = useSavedGroupReferences(savedGroup?.id);
  const referencingFeatures = references?.features ?? [];
  const referencingExperiments = references?.experiments ?? [];
  const referencingSavedGroups = references?.savedGroups ?? [];
  const totalReferences =
    referencingFeatures.length +
    referencingExperiments.length +
    referencingSavedGroups.length;

  const values = useMemo(() => savedGroup?.values ?? [], [savedGroup]);
  const [currentPage, setCurrentPage] = useState(1);
  const [filter, setFilter] = useState("");

  const { apiCall } = useAuth();
  const [importOperation, setImportOperation] = useState<"replace" | "append">(
    "replace",
  );
  const { projects } = useDefinitions();

  const approvalRequired =
    settings.approvalFlows?.savedGroups?.required ?? false;

  // Check if metadata review is required
  const metadataReviewRequired =
    approvalRequired &&
    (settings.approvalFlows?.savedGroups?.requireMetadataReview ?? true);

  const revisionState = useSavedGroupRevision(savedGroup?.id, mutate);
  const {
    selectedApprovalFlow: selectedRevision,
    selectedApprovalFlowId: selectedRevisionId,
    openApprovalFlows: openRevisions,
    allApprovalFlows: allRevisions,
    selectFlow,
    onApprovalFlowCreated: onRevisionCreated,
    handleDiscard,
    handlePublish,
    handleReopen,
    mutateApprovalFlows: mutateRevisions,
    userOpenFlow: userOpenRevision,
  } = revisionState;

  // When the user already has an open revision, block edits to the live version
  const editBlocked = !!userOpenRevision;

  // Revision state variables for UI logic
  const isLive = !selectedRevision;
  const isDraft =
    selectedRevision &&
    (selectedRevision.status === "draft" ||
      selectedRevision.status === "pending-review" ||
      selectedRevision.status === "changes-requested" ||
      selectedRevision.status === "approved");
  const isDiscarded =
    selectedRevision && selectedRevision.status === "discarded";
  const isMerged = selectedRevision && selectedRevision.status === "merged";
  const hasRevisions = allRevisions.length > 0;

  // Check for conflicts if there's a draft
  const mergeResult = useSavedGroupMergeResult(
    savedGroup,
    selectedRevision,
    allRevisions,
    isDraft,
  );

  // Close the changes modal when the selected revision is deselected (e.g. after publish/discard)
  useEffect(() => {
    if (!selectedRevision) {
      setShowChangesModal(false);
    }
  }, [selectedRevision]);

  // When a revision is selected, show its proposed state in the overview
  const displayedSavedGroup = useMemo(() => {
    if (!selectedRevision) return savedGroup;
    return {
      ...selectedRevision.target.snapshot,
      ...selectedRevision.target.proposedChanges,
    } as SavedGroupInterface;
  }, [selectedRevision, savedGroup]);

  const displayedValues = useMemo(
    () => displayedSavedGroup?.values ?? [],
    [displayedSavedGroup],
  );

  const filteredValues = displayedValues.filter((v) => v.match(filter));
  const sortedValues = sortNewestFirst
    ? filteredValues.reverse()
    : filteredValues;

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const valuesPage = sortedValues.slice(start, end);
  const { getOwnerDisplay, user } = useUser();

  const { hasLargeSavedGroupFeature, unsupportedConnections } =
    useLargeSavedGroupSupport();

  const [savedGroupForm, setSavedGroupForm] =
    useState<null | Partial<SavedGroupInterface>>(null);
  const [editConditionModal, setEditConditionModal] =
    useState<null | Partial<SavedGroupInterface>>(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const mutateValues = useCallback(
    (newValues: string[]) => {
      if (!savedGroup) return;
      mutate({
        savedGroup: {
          ...savedGroup,
          values: newValues,
        },
      });
    },
    [mutate, savedGroup],
  );

  const attr = (attributeSchema || []).find(
    (attr) => attr.property === savedGroup?.attributeKey,
  );

  const listAboveSizeLimit = useMemo(
    () =>
      savedGroupSizeLimit
        ? [...new Set(itemsToAdd.concat(values))].length > savedGroupSizeLimit
        : false,
    [savedGroupSizeLimit, itemsToAdd, values],
  );
  const displayRevision = useMemo(() => {
    if (selectedRevision) return selectedRevision;
    // For live, find the latest merged revision
    return [...allRevisions]
      .filter((r) => r.status === "merged")
      .sort(
        (a, b) =>
          new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
      )[0];
  }, [selectedRevision, allRevisions]);

  const revisionNumber = useMemo(() => {
    const getRevisionNumber = (revision: Revision | undefined) => {
      // If version is stored, use it
      if (revision?.version) return revision.version;

      // Fall back to calculating based on position (for old revisions without version)
      const sortedAllRevisions = [...allRevisions].sort(
        (a, b) =>
          new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
      );
      if (revision) {
        return sortedAllRevisions.findIndex((f) => f.id === revision.id) + 1;
      }
      return sortedAllRevisions.length;
    };

    if (selectedRevision) {
      return getRevisionNumber(selectedRevision);
    }
    if (userOpenRevision) {
      return getRevisionNumber(userOpenRevision);
    }
    // For live revision, use the latest merged revision
    return getRevisionNumber(displayRevision);
  }, [selectedRevision, userOpenRevision, displayRevision, allRevisions]);

  if (!data || !savedGroup) {
    return <LoadingOverlay />;
  }

  if (error) {
    return (
      <Callout status="error" mt="4">
        An error occurred: {error.message}
      </Callout>
    );
  }

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="large-saved-groups"
          commercialFeature="large-saved-groups"
        />
      )}
      {showAuditModal && savedGroup && (
        <AuditHistoryExplorerModal<SavedGroupInterface>
          entityId={savedGroup.id}
          entityName="Saved Group"
          config={{
            entityType: "savedGroup",
            includedEvents: ["savedGroup.created", "savedGroup.updated"],
            alwaysVisibleEvents: ["savedGroup.created"],
            labelOnlyEvents: [
              {
                event: "savedGroup.deleted",
                getLabel: () => "Deleted",
                alwaysVisible: true,
              },
            ],
            sections: [
              {
                label: "Settings",
                keys: ["groupName", "owner", "description"],
                render: renderSavedGroupSettings,
                getBadges: getSavedGroupSettingsBadges,
              },
              {
                label: "Targeting",
                keys: ["condition"],
                render: renderSavedGroupTargeting,
                getBadges: getSavedGroupTargetingBadges,
              },
              {
                label: "Values",
                keys: ["values", "attributeKey"],
                getBadges: getSavedGroupValuesBadges,
              },
              {
                label: "Projects",
                keys: ["projects"],
                render: renderSavedGroupProjects,
                getBadges: getSavedGroupProjectsBadges,
              },
            ],
            updateEventNames: ["savedGroup.updated"],
            defaultGroupBy: "minute",
            hideFilters: true,
            hiddenLabelSections: [OVERFLOW_SECTION_LABEL],
            normalizeSnapshot: (snapshot) => {
              if (!snapshot || typeof snapshot !== "object") return snapshot;
              let result = { ...snapshot };
              if (
                "condition" in result &&
                typeof result.condition === "string"
              ) {
                try {
                  result = {
                    ...result,
                    condition: JSON.parse(result.condition),
                  };
                } catch {
                  // leave as-is if unparseable
                }
              }
              if ("values" in result && Array.isArray(result.values)) {
                const vals = result.values as string[];
                const LIMIT = 100;
                if (vals.length > LIMIT) {
                  result = {
                    ...result,
                    values: [
                      ...vals.slice(0, LIMIT),
                      `— ${vals.length - LIMIT} more values...`,
                    ],
                  };
                }
              }
              return result;
            },
          }}
          onClose={() => setShowAuditModal(false)}
        />
      )}
      {addItems && (
        <Modal
          trackingEventModalType={`edit-saved-group-${importOperation}-items`}
          close={() => {
            setAddItems(false);
            setItemsToAdd([]);
          }}
          open={addItems}
          size="lg"
          header={
            importOperation === "append"
              ? "Add List Items"
              : "Overwrite List Contents"
          }
          cta={
            userOpenRevision
              ? "Update"
              : approvalRequired
                ? "Propose changes"
                : "Create draft"
          }
          ctaEnabled={
            itemsToAdd.length > 0 &&
            (!listAboveSizeLimit || adminBypassSizeLimit)
          }
          submit={async () => {
            if (importOperation === "append") {
              const res = await apiCall<{
                status: number;
                requiresApproval?: boolean;
                revision?: import("shared/enterprise").Revision;
              }>(`/saved-groups/${savedGroup.id}/add-items`, {
                method: "POST",
                body: JSON.stringify({
                  items: itemsToAdd,
                }),
              });
              if (res?.requiresApproval) {
                if (res.revision) {
                  onRevisionCreated(res.revision);
                }
                setItemsToAdd([]);
                return;
              }
              const newValues = new Set([...values, ...itemsToAdd]);
              mutateValues([...newValues]);
            } else {
              const res = await apiCall<{
                status: number;
                requiresApproval?: boolean;
                revision?: import("shared/enterprise").Revision;
              }>(`/saved-groups/${savedGroup.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  values: itemsToAdd,
                }),
              });
              if (res?.requiresApproval) {
                if (res.revision) {
                  onRevisionCreated(res.revision);
                }
                setItemsToAdd([]);
                return;
              }
              const newValues = new Set(itemsToAdd);
              mutateValues([...newValues]);
            }
            setItemsToAdd([]);
          }}
        >
          <>
            <div className="form-group">
              Updating this list will automatically update any associated
              Features and Experiments.
            </div>
            <IdListItemInput
              values={itemsToAdd}
              setValues={(newValues) => setItemsToAdd(newValues)}
              openUpgradeModal={() => setUpgradeModal(true)}
              listAboveSizeLimit={listAboveSizeLimit}
              bypassSizeLimit={adminBypassSizeLimit}
              setBypassSizeLimit={setAdminBypassSizeLimit}
              projects={savedGroup.projects}
            />
          </>
        </Modal>
      )}
      {savedGroupForm && (
        <SavedGroupForm
          close={() => {
            setSavedGroupForm(null);
            setIsCreatingNewRevision(false);
            mutate();
          }}
          current={savedGroupForm}
          type={savedGroup.type}
          approvalFlowRequired={approvalRequired}
          metadataReviewRequired={metadataReviewRequired}
          hasExistingRevision={!!userOpenRevision}
          onRevisionCreated={onRevisionCreated}
          openRevisions={openRevisions}
          allRevisions={allRevisions}
          selectedRevision={selectedRevision}
          onSelectRevision={selectFlow}
          liveVersion={savedGroup}
          isCreatingNewRevision={isCreatingNewRevision}
          editInfoOnly={true}
          autoBypassApproval={!metadataReviewRequired}
          mutate={mutate}
        />
      )}
      {editConditionModal && (
        <SavedGroupForm
          close={() => {
            setEditConditionModal(null);
            mutate();
          }}
          current={editConditionModal}
          type={savedGroup.type}
          approvalFlowRequired={approvalRequired}
          metadataReviewRequired={metadataReviewRequired}
          hasExistingRevision={!!userOpenRevision}
          onRevisionCreated={onRevisionCreated}
          openRevisions={openRevisions}
          allRevisions={allRevisions}
          selectedRevision={selectedRevision}
          onSelectRevision={selectFlow}
          liveVersion={savedGroup}
          editConditionOnly={true}
          mutate={mutate}
        />
      )}
      {showArchiveModal && displayedSavedGroup && (
        <SavedGroupArchiveModal
          savedGroup={displayedSavedGroup}
          close={() => setShowArchiveModal(false)}
          openRevisions={openRevisions}
          allRevisions={allRevisions}
          mutate={mutate}
          onRevisionCreated={onRevisionCreated}
          selectFlow={selectFlow}
        />
      )}
      {showReferencesModal && (
        <Modal
          header={`'${displayedSavedGroup?.groupName || savedGroup.groupName}' References`}
          trackingEventModalType="show-saved-group-references"
          close={() => setShowReferencesModal(false)}
          open={showReferencesModal}
          useRadixButton={true}
          closeCta="Close"
        >
          <Text as="p" mb="3">
            This saved group is referenced by the following features,
            experiments, and saved groups.
          </Text>
          <SavedGroupReferencesList
            features={referencingFeatures}
            experiments={referencingExperiments}
            savedGroups={referencingSavedGroups}
          />
        </Modal>
      )}
      {showChangesModal &&
        selectedRevision &&
        (() => {
          return (
            <Modal
              header={selectedRevision.title || `Revision ${revisionNumber}`}
              trackingEventModalType="saved-group-revision-changes"
              close={() => setShowChangesModal(false)}
              open={showChangesModal}
              dismissible
              size="max"
              hideCta={true}
              closeCta="Close"
              useRadixButton={true}
            >
              <RevisionDetail<SavedGroupInterface>
                diffConfig={REVISION_SAVED_GROUP_DIFF_CONFIG}
                revision={selectedRevision}
                currentState={savedGroup}
                mutate={() => {
                  mutateRevisions();
                  mutate();
                }}
                setCurrentRevision={(f) => selectFlow(f)}
                onDiscard={async (revisionId) => {
                  await handleDiscard(revisionId);
                }}
                onPublish={async (revisionId) => {
                  await handlePublish(revisionId);
                }}
                onReopen={async (revisionId) => {
                  await handleReopen(revisionId);
                }}
                allRevisions={allRevisions}
                requiresApproval={approvalRequired}
                closeModal={() => setShowChangesModal(false)}
              />
            </Modal>
          );
        })()}
      {confirmRevert && revisionToRevert && (
        <Modal
          header="Revert Merged Revision"
          trackingEventModalType="revert-revision"
          close={() => {
            setConfirmRevert(false);
            setRevisionToRevert(null);
          }}
          open={confirmRevert}
          cta="Create Revert Revision"
          submitColor="primary"
          submit={async () => {
            // Create a new revision that matches the exact state of the selected revision
            const snapshot = revisionToRevert.target
              .snapshot as SavedGroupInterface;
            const proposedChanges = revisionToRevert.target
              .proposedChanges as Record<string, unknown>;

            // Combine snapshot with proposed changes to get the exact state at that point
            const targetState = {
              ...snapshot,
              ...proposedChanges,
            };

            // Calculate changes needed to go from current live state to target state
            const revertChanges: Record<string, unknown> = {};

            // Compare each field in the target state with the current live state
            const fieldsToCheck = [
              "groupName",
              "owner",
              "values",
              "condition",
              "description",
              "projects",
            ] as const;

            fieldsToCheck.forEach((key) => {
              const targetValue = targetState[key];
              const currentValue = savedGroup[key];
              // Only include changes where values differ
              if (
                JSON.stringify(targetValue) !== JSON.stringify(currentValue)
              ) {
                revertChanges[key] = targetValue;
              }
            });

            // Build the revert title using the source revision's title
            const sourceTitle =
              revisionToRevert.title ||
              (() => {
                const sortedRevisions = [...allRevisions].sort(
                  (a, b) =>
                    new Date(a.dateCreated).getTime() -
                    new Date(b.dateCreated).getTime(),
                );
                const num =
                  sortedRevisions.findIndex(
                    (r) => r.id === revisionToRevert.id,
                  ) + 1;
                return `Revision ${num}`;
              })();
            const title = `Revert to "${sourceTitle}"`;

            // Create a new revision with the revert changes, title, and link back to original
            const res = await apiCall<{
              status: number;
              requiresApproval?: boolean;
              revision?: Revision;
            }>(
              `/saved-groups/${savedGroup.id}?forceCreateRevision=1&title=${encodeURIComponent(title)}&revertedFrom=${revisionToRevert.id}`,
              {
                method: "PUT",
                body: JSON.stringify(revertChanges),
              },
            );

            if (res?.revision) {
              onRevisionCreated(res.revision);
              selectFlow(res.revision);
            }

            setConfirmRevert(false);
            setRevisionToRevert(null);
          }}
        >
          <Text>
            This will create a new revision that restores the saved group to
            exactly how it was at the time of the selected revision (including
            all changes that were part of that revision).
          </Text>
          <Text mt="3" weight="medium">
            The new revision will need to be published to go live.
          </Text>
        </Modal>
      )}
      {compareRevisionsModalOpen && (
        <CompareSavedGroupRevisionsModal
          savedGroup={savedGroup}
          allRevisions={allRevisions}
          currentRevisionId={selectedRevisionId}
          onClose={() => setCompareRevisionsModalOpen(false)}
          mutate={() => {
            mutateRevisions();
            mutate();
          }}
          initialPreviewDraft={
            isDraft && selectedRevisionId ? selectedRevisionId : undefined
          }
          initialMode={isLive && !isDraft ? "most-recent-live" : undefined}
          requiresApproval={approvalRequired}
        />
      )}
      {conflictModal && selectedRevision && savedGroup && (
        <SavedGroupConflictModal
          savedGroup={savedGroup}
          revisions={allRevisions}
          selectedRevision={selectedRevision}
          close={() => setConflictModal(false)}
          mutate={() => {
            mutateRevisions();
            mutate();
          }}
        />
      )}
      {confirmNewDraft && (
        <Modal
          trackingEventModalType="create-new-saved-group-draft"
          open={true}
          close={() => {
            setConfirmNewDraft(false);
            setNewDraftTitle("");
            setNewDraftTitleStash("");
            setEditingNewDraftTitle(false);
            setCreatingDraft(false);
          }}
          header="Create New Draft"
          cta="Create Draft"
          loading={creatingDraft}
          useRadixButton={true}
          submit={async () => {
            setCreatingDraft(true);
            try {
              const params = new URLSearchParams();
              params.set("forceCreateRevision", "1");
              if (newDraftTitle.trim()) {
                params.set("title", newDraftTitle.trim());
              }
              const url = `/saved-groups/${savedGroup.id}?${params.toString()}`;

              const res = await apiCall<{
                status: number;
                requiresApproval?: boolean;
                revision?: Revision;
              }>(url, {
                method: "PUT",
                body: JSON.stringify({}),
              });

              if (res?.revision) {
                await mutateRevisions();
                await mutate();
                selectFlow(res.revision);
              }
              setConfirmNewDraft(false);
              setNewDraftTitle("");
              setNewDraftTitleStash("");
              setEditingNewDraftTitle(false);
            } finally {
              setCreatingDraft(false);
            }
          }}
        >
          <Flex direction="column" gap="2">
            <Text>
              Creating a <Text weight="bold">new draft</Text> based on{" "}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  whiteSpace: "nowrap",
                  backgroundColor: "var(--gray-a2)",
                  padding: "1px 4px",
                  margin: "2px",
                  borderRadius: "var(--radius-2)",
                }}
              >
                <Text as="span" size="3" weight="bold">
                  {selectedRevision ? (
                    <OverflowText
                      maxWidth={200}
                      title={
                        selectedRevision.title
                          ? `v${revisionNumber} - ${selectedRevision.title}`
                          : `v${revisionNumber}`
                      }
                    >
                      {selectedRevision.title
                        ? `v${revisionNumber} - ${selectedRevision.title}`
                        : `v${revisionNumber}`}
                    </OverflowText>
                  ) : (
                    "live"
                  )}
                </Text>
              </span>
            </Text>
            <Box my="3">
              <Flex align="center" gap="2">
                {newDraftTitle.trim() && !editingNewDraftTitle && (
                  <span
                    style={{
                      display: "inline-block",
                      fontVariantNumeric: "tabular-nums",
                      flexShrink: 0,
                    }}
                  >
                    <Text as="span" color="gray" size="2">
                      {(displayRevision?.version ?? allRevisions.length) + 1}.
                    </Text>
                  </span>
                )}
                {editingNewDraftTitle ? (
                  <Field
                    autoFocus
                    value={newDraftTitle}
                    placeholder={`Revision ${(displayRevision?.version ?? allRevisions.length) + 1}`}
                    onChange={(e) => setNewDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setEditingNewDraftTitle(false);
                      } else if (e.key === "Escape") {
                        setNewDraftTitle(newDraftTitleStash);
                        setEditingNewDraftTitle(false);
                      }
                    }}
                    onBlur={() => setEditingNewDraftTitle(false)}
                    containerStyle={{ maxWidth: 250, marginBottom: 0 }}
                    style={{
                      border: "none",
                      borderBottom: "1px solid var(--violet-9)",
                      borderRadius: 0,
                      outline: "none",
                      background: "transparent",
                      boxShadow: "none",
                      padding: "0 2px",
                      height: "auto",
                    }}
                  />
                ) : (
                  <Text weight="bold">
                    {newDraftTitle.trim() ||
                      `Revision ${(displayRevision?.version ?? allRevisions.length) + 1}`}
                  </Text>
                )}
                {!editingNewDraftTitle && (
                  <IconButton
                    variant="ghost"
                    color="violet"
                    size="2"
                    radius="full"
                    onClick={() => {
                      setNewDraftTitleStash(newDraftTitle);
                      setEditingNewDraftTitle(true);
                    }}
                    mx="1"
                  >
                    <PiPencilSimpleFill />
                  </IconButton>
                )}
              </Flex>
            </Box>
          </Flex>
        </Modal>
      )}
      <PageHead
        breadcrumb={[
          { display: "Saved Groups", href: "/saved-groups" },
          { display: displayedSavedGroup?.groupName || savedGroup.groupName },
        ]}
      />
      <div className="p-3 container-fluid pagecontents">
        <Flex align="center" justify="between" mb="4">
          <Flex align="center" gap="3">
            <Heading size="7" as="h1">
              {displayedSavedGroup?.groupName || savedGroup.groupName}
            </Heading>
            {displayedSavedGroup?.archived && (
              <Badge label="Archived" color="gray" />
            )}
          </Flex>
          <Flex gap="6" direction="row" align="center">
            <SavedGroupRevisionDropdown
              savedGroupId={savedGroup.id}
              allRevisions={allRevisions}
              selectedRevisionId={selectedRevisionId}
              onSelectRevision={selectFlow}
              requiresApproval={approvalRequired}
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
                  <BsThreeDotsVertical size={18} />
                </IconButton>
              }
              open={dropdownOpen}
              onOpenChange={setDropdownOpen}
              menuPlacement="end"
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  disabled={metadataReviewRequired && (isMerged || isDiscarded)}
                  tooltip={
                    metadataReviewRequired && isMerged
                      ? "You cannot edit a merged revision."
                      : metadataReviewRequired && isDiscarded
                        ? "You cannot edit a discarded revision."
                        : undefined
                  }
                  onClick={() => {
                    setDropdownOpen(false);
                    setSavedGroupForm(
                      selectedRevision
                        ? {
                            ...savedGroup,
                            ...((selectedRevision.target
                              .snapshot as SavedGroupInterface) || {}),
                            ...((selectedRevision.target
                              .proposedChanges as Partial<SavedGroupInterface>) ||
                              {}),
                          }
                        : savedGroup,
                    );
                  }}
                >
                  Edit Information
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setShowAuditModal(true);
                    setDropdownOpen(false);
                  }}
                >
                  View Audit Log
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {displayedSavedGroup?.archived ? (
                  <DropdownMenuItem
                    onClick={() => {
                      setDropdownOpen(false);
                      setShowArchiveModal(true);
                    }}
                  >
                    Unarchive
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    color="red"
                    onClick={() => {
                      setDropdownOpen(false);
                      setShowArchiveModal(true);
                    }}
                  >
                    Archive
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </DropdownMenu>
          </Flex>
        </Flex>
        <Flex align="center" gap="4" mb="4" wrap="wrap" justify="between">
          <Flex align="center" gap="4" wrap="wrap">
            {savedGroup.type === "list" && (
              <Text>
                Attribute Key: <strong>{savedGroup.attributeKey}</strong>
              </Text>
            )}
            {(projects.length > 0 ||
              (savedGroup.projects?.length ?? 0) > 0) && (
              <Flex align="center" gap="2">
                <Text>Projects:</Text>
                {(savedGroup.projects?.length || 0) > 0 ? (
                  <ProjectBadges
                    projectIds={savedGroup.projects}
                    resourceType="saved group"
                  />
                ) : (
                  <ProjectBadges resourceType="saved group" />
                )}
              </Flex>
            )}
            <Text>
              Date Updated: <strong>{ago(savedGroup.dateUpdated)}</strong>
            </Text>
            <Text>
              Owner:{" "}
              <strong>{getOwnerDisplay(savedGroup.owner) || "None"}</strong>
            </Text>
          </Flex>
          <Flex direction="column" align="end" gap="2">
            <SavedGroupReferences
              totalReferences={totalReferences}
              onShowReferences={() => setShowReferencesModal(true)}
            />
          </Flex>
        </Flex>
        {savedGroup.description && (
          <Text as="p" mb="3">
            {savedGroup.description}
          </Text>
        )}
        {savedGroup.type === "list" && !isIdListSupportedAttribute(attr) && (
          <Callout status="error" mt="3">
            The attribute for this saved group has an unsupported datatype. It
            cannot be edited and it may produce unexpected behavior when used in
            SDKs. Try using a{" "}
            <Link href="/saved-groups#conditionGroups">Condition Group</Link>{" "}
            instead
          </Callout>
        )}
        {(() => {
          const bannerProps = isDraft
            ? {
                icon: <PiPencil size={18} />,
                color: "var(--amber-11)",
                bgColor: "var(--amber-a3)",
                message: (
                  <>
                    Viewing a <strong>draft</strong> — changes will not go live
                    until published
                  </>
                ),
              }
            : metadataReviewRequired && isDiscarded
              ? {
                  icon: <PiProhibit size={18} />,
                  color: "var(--gray-11)",
                  bgColor: "var(--gray-a3)",
                  message: (
                    <>
                      Viewing a <strong>discarded</strong> revision — this was
                      never published
                    </>
                  ),
                }
              : metadataReviewRequired && isMerged
                ? {
                    icon: <PiLockSimple size={18} />,
                    color: "var(--gray-11)",
                    bgColor: "var(--gray-a3)",
                    message: (
                      <>
                        Viewing an old <strong>published</strong> revision — no
                        longer live
                      </>
                    ),
                  }
                : null;

          return (
            <>
              {bannerProps && (
                <div
                  ref={bannerRef}
                  style={{
                    position: "sticky",
                    top: 110,
                    zIndex: 920,
                    marginBottom: 12,
                    display: "flex",
                    justifyContent: "center",
                    pointerEvents: "none",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      backgroundColor: "var(--color-background)",
                      borderRadius: "var(--radius-3)",
                      overflow: "hidden",
                      maxWidth: bannerPinned ? "580px" : "2000px",
                      boxShadow: bannerPinned ? "var(--shadow-3)" : undefined,
                      transition: "all 200ms ease",
                      pointerEvents: "auto",
                    }}
                  >
                    <Flex
                      align="center"
                      justify="center"
                      gap="2"
                      px="4"
                      py="3"
                      style={{
                        color: bannerProps.color,
                        backgroundColor: bannerProps.bgColor,
                      }}
                    >
                      {bannerProps.icon}
                      <span style={{ fontSize: "var(--font-size-2)" }}>
                        {bannerProps.message}
                      </span>
                    </Flex>
                  </div>
                </div>
              )}
              <Frame mt="2" mb="4" px="6" py="4">
                <Flex
                  align="start"
                  justify="between"
                  mb="2"
                  wrap="wrap"
                  gap="2"
                >
                  <Flex align="start" gap="4" style={{ marginTop: 6 }}>
                    <Flex direction="column" gap="1">
                      {hasRevisions && (
                        <Text as="span" size="2" color="gray">
                          {selectedRevision?.title ||
                            `Revision ${revisionNumber}`}
                        </Text>
                      )}
                    </Flex>
                    {hasRevisions && allRevisions.length >= 2 && (
                      <>
                        <Separator
                          orientation="vertical"
                          style={{ marginTop: 2 }}
                        />
                        <Link
                          onClick={() => setCompareRevisionsModalOpen(true)}
                        >
                          <PiArrowsLeftRightBold
                            style={{ marginRight: 4, verticalAlign: "middle" }}
                          />
                          Compare revisions
                        </Link>
                      </>
                    )}
                  </Flex>
                  <Flex align="center" justify="end" gap="4" flexGrow="1">
                    {hasRevisions && isDiscarded && displayRevision && (
                      <Button
                        onClick={() => handleReopen(displayRevision.id)}
                        size="sm"
                      >
                        Reopen
                      </Button>
                    )}
                    {hasRevisions && isMerged && displayRevision && (
                      <Button
                        onClick={() => {
                          setRevisionToRevert(displayRevision);
                          setConfirmRevert(true);
                        }}
                        size="sm"
                      >
                        Revert to Previous
                      </Button>
                    )}
                    {hasRevisions &&
                      isDraft &&
                      displayRevision &&
                      displayRevision.authorId === user?.id && (
                        <Button
                          onClick={async () => {
                            await handleDiscard(displayRevision.id);
                          }}
                          color="red"
                          variant="ghost"
                          size="sm"
                        >
                          Discard
                        </Button>
                      )}
                    {isLive && (
                      <Button
                        onClick={() => setConfirmNewDraft(true)}
                        size="sm"
                        variant="soft"
                      >
                        New Draft
                      </Button>
                    )}
                    {hasRevisions && isDraft && (
                      <>
                        {mergeResult && !mergeResult.success && (
                          <Tooltip body="There have been conflicting changes published since this draft was created. Resolve them before publishing.">
                            <Button
                              variant="ghost"
                              color="red"
                              onClick={() => {
                                setConflictModal(true);
                              }}
                              size="sm"
                            >
                              Fix conflicts
                            </Button>
                          </Tooltip>
                        )}
                        <Tooltip
                          body={
                            mergeResult && !mergeResult.success
                              ? "This revision has conflicts — resolve them before publishing"
                              : ""
                          }
                        >
                          <Button
                            onClick={() => setShowChangesModal(true)}
                            size="sm"
                          >
                            {approvalRequired
                              ? displayRevision?.status === "draft"
                                ? "Request Approval to Publish"
                                : displayRevision?.status === "pending-review"
                                  ? "View Approval Request"
                                  : "View Changes"
                              : "Review & Publish"}
                          </Button>
                        </Tooltip>
                      </>
                    )}
                  </Flex>
                </Flex>
                <Separator size="4" my="3" />
                <Flex direction="column" gap="1">
                  <Flex align="center" gap="4" wrap="wrap">
                    <Metadata
                      label={hasRevisions ? "Revised by" : "Created by"}
                      value={
                        <span>
                          <UserAvatar
                            name={getOwnerDisplay(
                              hasRevisions && displayRevision
                                ? displayRevision.authorId
                                : savedGroup.owner,
                            )}
                            size="sm"
                            variant="soft"
                          />{" "}
                          {getOwnerDisplay(
                            hasRevisions && displayRevision
                              ? displayRevision.authorId
                              : savedGroup.owner,
                          )}
                        </span>
                      }
                    />
                    <Metadata
                      label="Created"
                      value={datetime(
                        hasRevisions && displayRevision
                          ? displayRevision.dateCreated
                          : savedGroup.dateCreated,
                      )}
                    />
                    {hasRevisions &&
                      (isLive || isMerged) &&
                      displayRevision?.resolution?.dateCreated && (
                        <Metadata
                          label="Published"
                          value={datetime(
                            displayRevision.resolution.dateCreated,
                          )}
                        />
                      )}
                  </Flex>
                </Flex>
              </Frame>
            </>
          );
        })()}
        {savedGroup.type === "list" && (
          <LargeSavedGroupPerformanceWarning
            hasLargeSavedGroupFeature={hasLargeSavedGroupFeature}
            unsupportedConnections={unsupportedConnections}
            openUpgradeModal={() => setUpgradeModal(true)}
          />
        )}
        {savedGroup.type === "condition" ? (
          <>
            <Flex align="center" justify="between" mb="3">
              <Heading size="4" mb="0">
                Condition
              </Heading>
              <Tooltip
                body={
                  isMerged
                    ? "You cannot edit a merged revision."
                    : isDiscarded
                      ? "You cannot edit a discarded revision."
                      : !selectedRevision
                        ? "Create a new draft first."
                        : undefined
                }
              >
                <Button
                  variant="outline"
                  disabled={!selectedRevision || isMerged || isDiscarded}
                  onClick={() => {
                    if (!selectedRevision && userOpenRevision) {
                      selectFlow(userOpenRevision);
                    }
                    setEditConditionModal(
                      selectedRevision
                        ? {
                            ...savedGroup,
                            ...((selectedRevision.target
                              .snapshot as SavedGroupInterface) || {}),
                            ...((selectedRevision.target
                              .proposedChanges as Partial<SavedGroupInterface>) ||
                              {}),
                          }
                        : savedGroup,
                    );
                  }}
                >
                  <PiPencil className="mr-1" />
                  Edit Condition
                </Button>
              </Tooltip>
            </Flex>
            <Text as="p" mb="3">
              Include all users who match the following:
            </Text>
            <Card mb="4">
              <Flex direction="row" gap="2" p="2">
                <Text weight="medium">IF</Text>
                <Box>
                  <ConditionDisplay
                    condition={displayedSavedGroup?.condition || ""}
                    savedGroups={[]}
                  />
                </Box>
              </Flex>
            </Card>
          </>
        ) : (
          <>
            <Flex align="center" justify="between" mb="3" gap="4">
              <Box className="relative" width="40%">
                <Field
                  placeholder="Search..."
                  type="search"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                  }}
                />
              </Box>
              <Flex gap="4" align="center">
                {selected.size > 0 && (
                  <DeleteButton
                    text={`Delete Selected (${selected.size})`}
                    title={`Delete selected item${selected.size > 1 ? "s" : ""}`}
                    disabled={editBlocked}
                    getConfirmationContent={async () => ""}
                    onClick={async () => {
                      const res = await apiCall<{
                        status: number;
                        requiresApproval?: boolean;
                        revision?: import("shared/enterprise").Revision;
                      }>(`/saved-groups/${savedGroup.id}/remove-items`, {
                        method: "POST",
                        body: JSON.stringify({ items: [...selected] }),
                      });
                      if (res?.requiresApproval) {
                        if (res.revision) {
                          onRevisionCreated(res.revision);
                        }
                        setSelected(new Set());
                        return;
                      }
                      const newValues = values.filter(
                        (value) => !selected.has(value),
                      );
                      mutateValues(newValues);
                      setSelected(new Set());
                    }}
                    link={true}
                    useIcon={true}
                    displayName={`${selected.size} selected item${
                      selected.size > 1 ? "s" : ""
                    }`}
                  />
                )}
                <Tooltip
                  body={
                    isMerged
                      ? "You cannot edit a merged revision."
                      : isDiscarded
                        ? "You cannot edit a discarded revision."
                        : !selectedRevision
                          ? "Create a new draft first."
                          : undefined
                  }
                >
                  <Button
                    variant="ghost"
                    color="red"
                    disabled={!selectedRevision || isMerged || isDiscarded}
                    onClick={() => {
                      // When viewing live, switch to/create draft first
                      if (!selectedRevision && userOpenRevision) {
                        selectFlow(userOpenRevision);
                      }
                      setImportOperation("replace");
                      setAddItems(true);
                    }}
                  >
                    Overwrite list
                  </Button>
                </Tooltip>
                <Tooltip
                  body={
                    isMerged
                      ? "You cannot edit a merged revision."
                      : isDiscarded
                        ? "You cannot edit a discarded revision."
                        : !selectedRevision
                          ? "Create a new draft first."
                          : undefined
                  }
                >
                  <Button
                    variant="outline"
                    disabled={!selectedRevision || isMerged || isDiscarded}
                    onClick={() => {
                      // When viewing live, switch to/create draft first
                      if (!selectedRevision && userOpenRevision) {
                        selectFlow(userOpenRevision);
                      }
                      setImportOperation("append");
                      setAddItems(true);
                    }}
                  >
                    <span className="mr-1 lh-full">
                      <FaPlusCircle />
                    </span>
                    <span className="lh-full">Add items</span>
                  </Button>
                </Tooltip>
              </Flex>
            </Flex>

            <table className="table gbtable table-hover appbox table-valign-top">
              <thead>
                <tr>
                  <th style={{ width: "48px" }}>
                    <Checkbox
                      value={
                        values.length > 0 && selected.size === values.length
                      }
                      setValue={(checked) => {
                        if (checked) {
                          setSelected(new Set(values));
                        } else {
                          setSelected(new Set());
                        }
                      }}
                      size="sm"
                    />
                  </th>
                  <th>
                    <Flex justify="between" align="center">
                      <span>{savedGroup.attributeKey}</span>
                      <div
                        className="cursor-pointer text-color-primary"
                        onClick={() => {
                          setSortNewestFirst(!sortNewestFirst);
                          setCurrentPage(1);
                        }}
                      >
                        <PiArrowsDownUp className="mr-1 lh-full align-middle" />
                        <span className="lh-full align-middle">
                          {sortNewestFirst
                            ? "Most Recently Added"
                            : "Least Recently Added"}
                        </span>
                      </div>
                    </Flex>
                  </th>
                </tr>
              </thead>
              <tbody>
                {valuesPage.map((value) => {
                  return (
                    <tr
                      key={value}
                      onClick={() => {
                        if (selected.has(value)) {
                          const newSelected = new Set(selected);
                          newSelected.delete(value);
                          setSelected(newSelected);
                        } else {
                          setSelected(new Set(selected).add(value));
                        }
                      }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          value={selected.has(value)}
                          setValue={(checked) => {
                            if (checked) {
                              setSelected(new Set(selected).add(value));
                            } else {
                              const newSelected = new Set(selected);
                              newSelected.delete(value);
                              setSelected(newSelected);
                            }
                          }}
                          size="sm"
                        />
                      </td>
                      <td>{value}</td>
                    </tr>
                  );
                })}
                {!displayedValues.length && (
                  <tr>
                    <td colSpan={2}>
                      This group doesn&apos;t have any items yet
                    </td>
                  </tr>
                )}
                {displayedValues.length && !filteredValues.length ? (
                  <tr>
                    <td colSpan={2}>No matching items</td>
                  </tr>
                ) : (
                  <></>
                )}
              </tbody>
            </table>
            {Math.ceil(filteredValues.length / NUM_PER_PAGE) > 1 && (
              <Pagination
                numItemsTotal={displayedValues.length}
                currentPage={currentPage}
                perPage={NUM_PER_PAGE}
                onPageChange={(d) => {
                  setCurrentPage(d);
                }}
              />
            )}
            {!displayedValues.length &&
              !displayedSavedGroup?.useEmptyListGroup && (
                <Callout status="info">
                  This saved group has legacy behavior when empty and will be
                  completely ignored when used for targeting.{" "}
                  <DocLink docSection="idLists">Learn More</DocLink>
                </Callout>
              )}
          </>
        )}
      </div>
    </>
  );
}
