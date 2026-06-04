import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { useRouter } from "next/router";
import { SavedGroupInterface } from "shared/types/saved-group";
import {
  Revision,
  applyTopLevelPatchOps,
  isSavedGroupRevisionMetadataOnly,
} from "shared/enterprise";
import { ago, datetime } from "shared/dates";
import { FaPlusCircle } from "react-icons/fa";
import {
  PiArrowsDownUp,
  PiPencil,
  PiProhibit,
  PiLockSimple,
  PiPencilSimpleFill,
  PiGitDiff,
  PiCaretRightFill,
} from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { isIdListSupportedAttribute } from "shared/util";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";
import PageHead from "@/components/Layout/PageHead";
import Pagination from "@/components/Pagination";
import Frame from "@/ui/Frame";
import Metadata from "@/ui/Metadata";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import { getStatusBadge } from "@/components/Revision/revisionUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import SavedGroupForm from "@/components/SavedGroups/SavedGroupForm";
import SavedGroupArchiveModal from "@/components/SavedGroups/SavedGroupArchiveModal";
import SavedGroupDeleteModal from "@/components/SavedGroups/SavedGroupDeleteModal";
import {
  SavedGroupConflictModal,
  useSavedGroupMergeResult,
} from "@/components/SavedGroups/useSavedGroupConflictModal";
import Modal from "@/components/Modal";
import LoadingOverlay from "@/components/LoadingOverlay";
import { IdListItemInput } from "@/components/SavedGroups/IdListItemInput";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import LargeSavedGroupPerformanceWarning, {
  useLargeSavedGroupSupport,
} from "@/components/SavedGroups/LargeSavedGroupSupportWarning";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import Owner from "@/components/Avatar/Owner";
import AuditHistoryExplorerModal from "@/components/AuditHistoryExplorer/AuditHistoryExplorerModal";
import { OVERFLOW_SECTION_LABEL } from "@/components/AuditHistoryExplorer/useAuditDiff";
import {
  renderSavedGroupTargeting,
  renderSavedGroupSettings,
  getSavedGroupSettingsBadges,
  getSavedGroupTargetingBadges,
  getSavedGroupValuesBadges,
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
import EventUser from "@/components/Avatar/EventUser";
import { useScrollPosition } from "@/hooks/useScrollPosition";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import SavedGroupDraftSelectorForChanges, {
  DraftMode,
} from "@/components/SavedGroups/SavedGroupDraftSelectorForChanges";

const NUM_PER_PAGE = 10;

function CoAuthorsFromIds({
  authorId,
  contributorIds,
}: {
  authorId: string;
  contributorIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const filtered = contributorIds.filter((id) => id !== authorId);
  if (filtered.length === 0) return null;
  const label = `Co-author${filtered.length > 1 ? "s" : ""} (${filtered.length})`;
  return (
    <Box mt="3" mb="3">
      <div
        className="link-purple"
        style={{
          cursor: "pointer",
          userSelect: "none",
          display: "inline-block",
        }}
        onClick={() => setOpen((o) => !o)}
      >
        <PiCaretRightFill
          style={{
            display: "inline",
            marginRight: 4,
            transition: "transform 0.15s ease",
            transform: open ? "rotate(90deg)" : "none",
          }}
        />
        {label}
      </div>
      {open && (
        <Flex direction="column" gap="2" mt="2" ml="3">
          {filtered.map((id) => (
            <EventUser
              key={id}
              user={{ type: "dashboard", id, name: "", email: "" }}
              display="avatar-name-email"
              size="sm"
              wrap={true}
            />
          ))}
        </Flex>
      )}
    </Box>
  );
}

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
  const [addItemsDraftMode, setAddItemsDraftMode] = useState<DraftMode>("new");
  const [addItemsDraftSelectedId, setAddItemsDraftSelectedId] = useState<
    string | null
  >(null);
  const [deleteItemsModal, setDeleteItemsModal] = useState(false);
  const [deleteItemsDraftMode, setDeleteItemsDraftMode] =
    useState<DraftMode>("new");
  const [deleteItemsDraftSelectedId, setDeleteItemsDraftSelectedId] = useState<
    string | null
  >(null);
  const [confirmRevert, setConfirmRevert] = useState<boolean>(false);
  const [revisionToRevert, setRevisionToRevert] = useState<Revision | null>(
    null,
  );
  // Whether the user has opted to flip `archived` as part of a revert when
  // the live entity's archive state has drifted from the target revision's.
  // Defaults are set in the effect below: true for "will un-archive" (the
  // common recovery path), false for "will re-archive" (so re-archiving stays
  // an opt-in action).
  const [revertIncludeArchive, setRevertIncludeArchive] =
    useState<boolean>(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

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
    settings.approvalFlows?.savedGroups?.[0]?.required ?? false;

  // Check if metadata review is required
  const metadataReviewRequired =
    approvalRequired &&
    (settings.approvalFlows?.savedGroups?.[0]?.requireMetadataReview ?? true);

  const revisionState = useSavedGroupRevision(
    savedGroup?.id,
    mutate,
    savedGroup,
  );
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

  // Per-revision approval gate: even when the org globally requires approval
  // for saved groups, a metadata-only revision can be published without
  // review when the `requireMetadataReview` setting is disabled. Mirrors the
  // server-side rule in the saved-group adapter so UI affordances (CTA copy,
  // publish button) match what the merge endpoint will actually allow.
  const selectedRevisionRequiresApproval =
    !!selectedRevision &&
    approvalRequired &&
    (metadataReviewRequired ||
      !isSavedGroupRevisionMetadataOnly(
        selectedRevision.target.proposedChanges,
      ));

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

  // When the user opens a revert modal, default `revertIncludeArchive` based
  // on the direction of the archive drift: pre-checked for "will un-archive"
  // (the common recovery flow), unchecked for "will re-archive" so the more
  // disruptive direction stays opt-in.
  useEffect(() => {
    if (!confirmRevert || !revisionToRevert || !savedGroup) return;
    const targetState = applyTopLevelPatchOps(
      revisionToRevert.target.snapshot as SavedGroupInterface,
      revisionToRevert.target.proposedChanges,
    ) as SavedGroupInterface;
    const targetArchived = !!targetState.archived;
    const liveArchived = !!savedGroup.archived;
    if (targetArchived === liveArchived) {
      setRevertIncludeArchive(false);
      return;
    }
    // Drift exists: default to `true` only when the revert would un-archive
    // (i.e. live is archived but the target was not).
    setRevertIncludeArchive(liveArchived && !targetArchived);
  }, [confirmRevert, revisionToRevert, savedGroup]);

  // Sync title draft when selected revision changes
  useEffect(() => {
    setEditingTitle(false);
    setTitleDraft(selectedRevision?.title || "");
  }, [selectedRevision?.id, selectedRevision?.title]);

  const commitTitleEdit = useCallback(async () => {
    if (!selectedRevision) return;
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (next !== (selectedRevision.title ?? "")) {
      await apiCall(`/revision/${selectedRevision.id}/title`, {
        method: "PATCH",
        body: JSON.stringify({ title: next }),
      });
      await mutateRevisions();
    }
  }, [titleDraft, selectedRevision, apiCall, mutateRevisions]);

  // When a revision is selected, show its proposed state in the overview
  const displayedSavedGroup = useMemo(() => {
    if (!selectedRevision) return savedGroup;
    return applyTopLevelPatchOps(
      selectedRevision.target.snapshot as SavedGroupInterface,
      selectedRevision.target.proposedChanges,
    ) as SavedGroupInterface;
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
  const { user } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const canAdminPublish =
    !!approvalRequired &&
    !!savedGroup?.id &&
    (user?.role === "admin" ||
      (savedGroup?.projects?.length
        ? savedGroup.projects.every((project) =>
            permissionsUtil.canBypassApprovalChecks({ project: project || "" }),
          )
        : permissionsUtil.canBypassApprovalChecks({ project: "" })));

  const canAutoPublish = !approvalRequired || canAdminPublish;

  const { hasLargeSavedGroupFeature, unsupportedConnections, connections } =
    useLargeSavedGroupSupport();

  const [savedGroupForm, setSavedGroupForm] =
    useState<null | Partial<SavedGroupInterface>>(null);
  const [editConditionModal, setEditConditionModal] =
    useState<null | Partial<SavedGroupInterface>>(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());

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
                label: "Saved Group Settings",
                keys: ["groupName", "owner", "description", "projects"],
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
      {deleteItemsModal && (
        <Modal
          trackingEventModalType="delete-saved-group-items"
          close={() => setDeleteItemsModal(false)}
          open={deleteItemsModal}
          header={`Delete ${selected.size} item${selected.size !== 1 ? "s" : ""}`}
          cta={
            deleteItemsDraftMode === "publish"
              ? approvalRequired && canAdminPublish
                ? "Bypass approval & publish"
                : "Publish"
              : deleteItemsDraftMode === "existing"
                ? "Update draft"
                : approvalRequired
                  ? "Propose changes"
                  : "Create draft"
          }
          submit={async () => {
            const newValues = displayedValues.filter((v) => !selected.has(v));

            const params = new URLSearchParams();
            if (deleteItemsDraftMode === "publish") {
              params.set("autoPublish", "1");
              if (approvalRequired && canAdminPublish) {
                params.set("bypassApproval", "1");
              }
            } else if (
              deleteItemsDraftMode === "existing" &&
              deleteItemsDraftSelectedId
            ) {
              params.set("revisionId", deleteItemsDraftSelectedId);
            } else {
              params.set("forceCreateRevision", "1");
            }

            const res = await apiCall<{
              status: number;
              revision?: Revision;
            }>(`/saved-groups/${savedGroup.id}?${params.toString()}`, {
              method: "PUT",
              body: JSON.stringify({ values: newValues }),
            });

            if (res?.revision) {
              onRevisionCreated(res.revision);
            } else {
              mutate();
            }
            setSelected(new Set());
            setDeleteItemsModal(false);
          }}
        >
          <SavedGroupDraftSelectorForChanges
            savedGroup={savedGroup}
            openRevisions={openRevisions}
            allRevisions={allRevisions}
            mode={deleteItemsDraftMode}
            setMode={setDeleteItemsDraftMode}
            selectedDraftId={deleteItemsDraftSelectedId}
            setSelectedDraftId={setDeleteItemsDraftSelectedId}
            canAutoPublish={canAutoPublish}
            approvalRequired={approvalRequired}
            defaultExpanded={!canAutoPublish}
          />
        </Modal>
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
            addItemsDraftMode === "publish"
              ? approvalRequired && canAdminPublish
                ? "Bypass approval & publish"
                : "Publish"
              : addItemsDraftMode === "existing"
                ? "Update draft"
                : approvalRequired
                  ? "Propose changes"
                  : "Create draft"
          }
          ctaEnabled={
            itemsToAdd.length > 0 &&
            (!listAboveSizeLimit || adminBypassSizeLimit)
          }
          submit={async () => {
            const newValues =
              importOperation === "append"
                ? [...new Set([...displayedValues, ...itemsToAdd])]
                : [...new Set(itemsToAdd)];

            const params = new URLSearchParams();
            if (addItemsDraftMode === "publish") {
              params.set("autoPublish", "1");
              if (approvalRequired && canAdminPublish) {
                params.set("bypassApproval", "1");
              }
            } else if (
              addItemsDraftMode === "existing" &&
              addItemsDraftSelectedId
            ) {
              params.set("revisionId", addItemsDraftSelectedId);
            } else {
              params.set("forceCreateRevision", "1");
            }

            const res = await apiCall<{
              status: number;
              requiresApproval?: boolean;
              revision?: Revision;
            }>(`/saved-groups/${savedGroup.id}?${params.toString()}`, {
              method: "PUT",
              body: JSON.stringify({ values: newValues }),
            });

            if (res?.revision) {
              onRevisionCreated(res.revision);
            } else {
              mutate();
            }
            setItemsToAdd([]);
          }}
        >
          <>
            <div className="form-group">
              {approvalRequired
                ? "Changes will be saved as a draft and must be reviewed before taking effect."
                : "Changes will be saved as a draft revision."}
            </div>
            <SavedGroupDraftSelectorForChanges
              savedGroup={savedGroup}
              openRevisions={openRevisions}
              allRevisions={allRevisions}
              mode={addItemsDraftMode}
              setMode={setAddItemsDraftMode}
              selectedDraftId={addItemsDraftSelectedId}
              setSelectedDraftId={setAddItemsDraftSelectedId}
              canAutoPublish={canAutoPublish}
              approvalRequired={approvalRequired}
              defaultExpanded={!canAutoPublish}
            />
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
            mutate();
          }}
          current={savedGroupForm}
          type={savedGroup.type}
          approvalFlowRequired={approvalRequired}
          metadataReviewRequired={metadataReviewRequired}
          onRevisionCreated={onRevisionCreated}
          openRevisions={openRevisions}
          allRevisions={allRevisions}
          selectedRevision={selectedRevision}
          onSelectRevision={selectFlow}
          liveVersion={savedGroup}
          editInfoOnly={true}
          // Signal the metadata-only shortcut when the org has review enabled
          // but metadata review disabled. The draft selector is still shown so
          // users can opt into a draft; this flag just defaults the initial
          // mode to "publish" and routes publish through autoPublish (no admin
          // bypass required) since the caller asserts approval isn't needed
          // for metadata changes.
          autoBypassApproval={approvalRequired && !metadataReviewRequired}
          mutate={async () => {
            await Promise.all([mutateRevisions(), mutate()]);
          }}
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
          onRevisionCreated={onRevisionCreated}
          openRevisions={openRevisions}
          allRevisions={allRevisions}
          selectedRevision={selectedRevision}
          onSelectRevision={selectFlow}
          liveVersion={savedGroup}
          editConditionOnly={true}
          mutate={async () => {
            await Promise.all([mutateRevisions(), mutate()]);
          }}
        />
      )}
      {showArchiveModal && displayedSavedGroup && (
        <SavedGroupArchiveModal
          savedGroup={displayedSavedGroup}
          close={() => setShowArchiveModal(false)}
          openRevisions={openRevisions}
          allRevisions={allRevisions}
          mutate={async () => {
            await Promise.all([mutateRevisions(), mutate()]);
          }}
          onRevisionCreated={onRevisionCreated}
          selectFlow={selectFlow}
        />
      )}
      {showDeleteModal && (
        <SavedGroupDeleteModal
          savedGroup={savedGroup}
          close={() => setShowDeleteModal(false)}
          onDelete={async () => {
            await apiCall(`/saved-groups/${savedGroup.id}`, {
              method: "DELETE",
            });
            // Use the Next.js router rather than window.history (per workspace
            // rule). Navigates back to the list and unmounts this page.
            await router.push("/saved-groups");
          }}
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
                mutate={async () => {
                  await Promise.all([mutateRevisions(), mutate()]);
                }}
                setCurrentRevision={(f) => selectFlow(f)}
                onPublish={async (revisionId) => {
                  await handlePublish(revisionId);
                }}
                onReopen={async (revisionId) => {
                  await handleReopen(revisionId);
                }}
                allRevisions={allRevisions}
                // Defer to the per-revision gate so metadata-only revisions
                // skip the review dance when `requireMetadataReview` is off
                // (matching the server-side rule in the saved-group adapter).
                requiresApproval={selectedRevisionRequiresApproval}
                closeModal={() => setShowChangesModal(false)}
              />
            </Modal>
          );
        })()}
      {confirmRevert &&
        revisionToRevert &&
        (() => {
          // Compute the target state and archive-drift direction so we can
          // both render the opt-in checkbox and use the same target inside
          // the submit handler.
          const targetState = applyTopLevelPatchOps(
            revisionToRevert.target.snapshot as SavedGroupInterface,
            revisionToRevert.target.proposedChanges,
          ) as SavedGroupInterface;
          const targetArchived = !!targetState.archived;
          const liveArchived = !!savedGroup.archived;
          const archiveDrifts = targetArchived !== liveArchived;
          const willUnarchive =
            archiveDrifts && liveArchived && !targetArchived;
          return (
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
                  if (
                    JSON.stringify(targetValue) !== JSON.stringify(currentValue)
                  ) {
                    revertChanges[key] = targetValue;
                  }
                });

                // Only include `archived` when the user explicitly opted in;
                // by default a revert leaves the live archive state alone,
                // matching the "live + ops" merge semantics.
                if (archiveDrifts && revertIncludeArchive) {
                  revertChanges.archived = targetArchived;
                }

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
                exactly how it was at the time of the selected revision
                (including all changes that were part of that revision).
              </Text>
              {archiveDrifts && (
                <Callout status="warning" mt="3">
                  <Checkbox
                    label={
                      willUnarchive
                        ? "Also un-archive (currently archived)"
                        : "Also archive (currently active)"
                    }
                    value={revertIncludeArchive}
                    setValue={setRevertIncludeArchive}
                  />
                </Callout>
              )}
              <Text mt="3" weight="medium">
                The new revision will need to be published to go live.
              </Text>
            </Modal>
          );
        })()}
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
          selectedRevision={selectedRevision}
          close={() => setConflictModal(false)}
          mutate={async () => {
            await Promise.all([mutateRevisions(), mutate()]);
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
              Creating a <Text weight="semibold">new draft</Text> based on{" "}
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
                <Text as="span" size="large" weight="semibold">
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
                    <Text as="span" color="text-low" size="small">
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
                  <Text weight="semibold">
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
      <div className="container-fluid pagecontents">
        <Flex align="start" justify="between" gap="2">
          <Flex align="center" mb="2" gap="3" style={{ marginTop: "-4px" }}>
            <Heading size="2x-large" as="h1" mb="0">
              {displayedSavedGroup?.groupName || savedGroup.groupName}
            </Heading>
            {displayedSavedGroup?.archived && (
              <Badge label="Archived" color="gray" />
            )}
          </Flex>
          <Flex align="center" gap="4" pr="2">
            <SavedGroupRevisionDropdown
              savedGroupId={savedGroup.id}
              allRevisions={allRevisions}
              selectedRevisionId={selectedRevisionId}
              onSelectRevision={selectFlow}
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
              open={dropdownOpen}
              onOpenChange={setDropdownOpen}
              menuPlacement="end"
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  disabled={
                    !!(metadataReviewRequired && (isMerged || isDiscarded))
                  }
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
                        ? applyTopLevelPatchOps(
                            (selectedRevision.target
                              .snapshot as SavedGroupInterface) || savedGroup,
                            selectedRevision.target.proposedChanges,
                          )
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
                  Audit History
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
                    onClick={() => {
                      setDropdownOpen(false);
                      setShowArchiveModal(true);
                    }}
                  >
                    Archive
                  </DropdownMenuItem>
                )}
                {/* Delete is gated on the LIVE archive state, not the
                    displayed/draft state — the server enforces the same
                    rule, and we want users to publish the archive before
                    they can delete. */}
                {savedGroup.archived &&
                  permissionsUtil.canDeleteSavedGroup(savedGroup) && (
                    <DropdownMenuItem
                      color="red"
                      onClick={() => {
                        setDropdownOpen(false);
                        setShowDeleteModal(true);
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  )}
              </DropdownMenuGroup>
            </DropdownMenu>
          </Flex>
        </Flex>
        <Flex align="center" gap="4" mb="4" wrap="wrap" justify="between">
          <Flex gap="4" align="center" wrap="wrap">
            {savedGroup.type === "list" && (
              <Box>
                <Text weight="medium">Attribute Key: </Text>
                {savedGroup.attributeKey}
              </Box>
            )}
            {(projects.length > 0 ||
              (displayedSavedGroup?.projects?.length ?? 0) > 0) && (
              <Metadata
                label="Projects"
                value={
                  (displayedSavedGroup?.projects?.length || 0) > 0 ? (
                    <Text weight="regular" color="text-mid">
                      {displayedSavedGroup?.projects
                        ?.map(
                          (p) =>
                            projects.find((proj) => proj.id === p)?.name || p,
                        )
                        .join(", ") || "All projects"}
                    </Text>
                  ) : (
                    <Text weight="regular" color="text-mid">
                      All projects
                    </Text>
                  )
                }
              />
            )}
            <Box>
              <Text weight="medium">Owner: </Text>
              <Owner
                ownerId={displayedSavedGroup?.owner ?? savedGroup.owner}
                gap="1"
              />
            </Box>
          </Flex>
          <Flex direction="column" align="end" gap="2">
            <SavedGroupReferences
              totalReferences={totalReferences}
              onShowReferences={() => setShowReferencesModal(true)}
            />
          </Flex>
        </Flex>
        {displayedSavedGroup?.description && (
          <Text as="p" mb="3">
            {displayedSavedGroup.description}
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
                        Viewing a previously <strong>published</strong>{" "}
                        revision.{" "}
                        <span
                          style={{
                            cursor: "pointer",
                            color: "var(--accent-11)",
                            fontWeight: 600,
                            textUnderlineOffset: 2,
                          }}
                          onClick={() => selectFlow(null)}
                        >
                          Switch to live
                        </span>
                      </>
                    ),
                  }
                : isLive
                  ? (() => {
                      const activeDrafts = allRevisions.filter(
                        (r) =>
                          r.status === "draft" ||
                          r.status === "approved" ||
                          r.status === "changes-requested" ||
                          r.status === "pending-review",
                      );
                      if (activeDrafts.length === 0) return null;
                      return {
                        icon: <PiPencil size={18} />,
                        color: "var(--gray-11)",
                        bgColor: "var(--gray-a3)",
                        message: (
                          <>
                            This saved group has{" "}
                            <strong>
                              {activeDrafts.length === 1
                                ? "a draft revision"
                                : `${activeDrafts.length} draft revisions`}
                            </strong>
                            {activeDrafts.length === 1 && (
                              <>
                                {". "}
                                <span
                                  style={{
                                    cursor: "pointer",
                                    color: "var(--accent-11)",
                                    fontWeight: 600,
                                    textUnderlineOffset: 2,
                                  }}
                                  onClick={() => selectFlow(activeDrafts[0])}
                                >
                                  Switch to draft
                                </span>
                              </>
                            )}
                          </>
                        ),
                      };
                    })()
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
                  <Flex align="start" gap="4" style={{ marginTop: 5 }}>
                    <Flex direction="column" gap="1">
                      {hasRevisions && (
                        <Flex align="center" gap="2">
                          {displayRevision?.title && (
                            <span
                              style={{
                                display: "inline-block",
                                fontVariantNumeric: "tabular-nums",
                                flexShrink: 0,
                              }}
                            >
                              <Text as="span" color="text-mid" size="medium">
                                {revisionNumber}.
                              </Text>
                            </span>
                          )}
                          {editingTitle ? (
                            <Field
                              autoFocus
                              value={titleDraft}
                              placeholder={`Revision ${revisionNumber}`}
                              onChange={(e) => setTitleDraft(e.target.value)}
                              onKeyDown={async (e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  await commitTitleEdit();
                                } else if (e.key === "Escape") {
                                  setEditingTitle(false);
                                  setTitleDraft(selectedRevision?.title || "");
                                }
                              }}
                              onBlur={commitTitleEdit}
                              containerStyle={{
                                maxWidth: 250,
                                marginBottom: 0,
                              }}
                              style={{
                                border: "none",
                                borderBottom: "1px solid var(--violet-9)",
                                borderCollapse: "collapse",
                                borderRadius: 0,
                                outline: "none",
                                background: "transparent",
                                boxShadow: "none",
                                padding: "0 2px",
                                height: "auto",
                                fontSize: "var(--font-size-3)",
                                fontWeight: 700,
                              }}
                            />
                          ) : (
                            <Text weight="semibold" size="large">
                              <OverflowText
                                maxWidth={250}
                                title={
                                  displayRevision?.title ||
                                  `Revision ${revisionNumber}`
                                }
                              >
                                {displayRevision?.title ||
                                  `Revision ${revisionNumber}`}
                              </OverflowText>
                            </Text>
                          )}
                          {isDraft &&
                            selectedRevision?.authorId === user?.id &&
                            !editingTitle && (
                              <IconButton
                                variant="ghost"
                                color="violet"
                                size="2"
                                radius="full"
                                onClick={() => {
                                  setTitleDraft(selectedRevision?.title || "");
                                  setEditingTitle(true);
                                }}
                                mx="1"
                              >
                                <PiPencilSimpleFill />
                              </IconButton>
                            )}
                          <Box flexShrink="0">
                            {getStatusBadge(
                              isLive
                                ? "live"
                                : (selectedRevision?.status ?? "draft"),
                            )}
                          </Box>
                        </Flex>
                      )}
                    </Flex>
                    {hasRevisions && allRevisions.length >= 2 && (
                      <>
                        <Separator
                          orientation="vertical"
                          style={{ marginTop: 2 }}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<PiGitDiff />}
                          onClick={() => setCompareRevisionsModalOpen(true)}
                          style={{ position: "relative", top: -5 }}
                        >
                          Compare revisions
                        </Button>
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
                            {selectedRevisionRequiresApproval
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
                <Flex direction="column">
                  <Flex
                    align="center"
                    justify="between"
                    wrap="wrap"
                    style={{
                      rowGap: "var(--space-1)",
                      columnGap: "var(--space-4)",
                    }}
                  >
                    <Metadata
                      label={hasRevisions ? "Revised by" : "Created by"}
                      value={
                        <EventUser
                          user={{
                            type: "dashboard",
                            id:
                              hasRevisions && displayRevision
                                ? displayRevision.authorId
                                : savedGroup.owner,
                            name: "",
                            email: "",
                          }}
                          display="avatar-name-email"
                          size="sm"
                        />
                      }
                    />
                    <Flex align="center" gap="4" wrap="wrap">
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
                      {hasRevisions && isDraft && displayRevision && (
                        <Metadata
                          label="Last update"
                          value={ago(displayRevision.dateUpdated)}
                        />
                      )}
                    </Flex>
                  </Flex>
                  {hasRevisions &&
                    displayRevision &&
                    (() => {
                      const coAuthorIds = (
                        displayRevision.contributors ?? []
                      ).filter((id) => id !== displayRevision.authorId);
                      if (coAuthorIds.length === 0) return null;
                      return (
                        <CoAuthorsFromIds
                          authorId={displayRevision.authorId}
                          contributorIds={coAuthorIds}
                        />
                      );
                    })()}
                </Flex>
              </Frame>
            </>
          );
        })()}
        {savedGroup.type === "list" && (
          <LargeSavedGroupPerformanceWarning
            hasLargeSavedGroupFeature={hasLargeSavedGroupFeature}
            unsupportedConnections={unsupportedConnections}
            connections={connections}
            openUpgradeModal={() => setUpgradeModal(true)}
          />
        )}
        {savedGroup.type === "condition" ? (
          <>
            <Heading size="medium" as="h2" mb="3">
              Condition
            </Heading>

            <Frame mb="4" px="6" py="5">
              <Flex justify="between" align="center">
                <Text as="div" weight="semibold" mb="4">
                  Include all users who match:
                </Text>
                <Tooltip
                  body={
                    isMerged
                      ? "You cannot edit a merged revision."
                      : isDiscarded
                        ? "You cannot edit a discarded revision."
                        : ""
                  }
                >
                  <Button
                    variant="ghost"
                    disabled={!!(isMerged || isDiscarded)}
                    onClick={() => {
                      if (!selectedRevision && userOpenRevision) {
                        selectFlow(userOpenRevision);
                      }
                      setEditConditionModal(
                        selectedRevision
                          ? applyTopLevelPatchOps(
                              (selectedRevision.target
                                .snapshot as SavedGroupInterface) || savedGroup,
                              selectedRevision.target.proposedChanges,
                            )
                          : savedGroup,
                      );
                    }}
                  >
                    Edit
                  </Button>
                </Tooltip>
              </Flex>
              <Flex direction="row" gap="2">
                <Text weight="medium">IF</Text>
                <Box>
                  <ConditionDisplay
                    condition={displayedSavedGroup?.condition || ""}
                    savedGroups={[]}
                  />
                </Box>
              </Flex>
            </Frame>
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
                  <Button
                    variant="ghost"
                    color="red"
                    onClick={() => {
                      setDeleteItemsDraftMode(
                        !approvalRequired
                          ? "publish"
                          : userOpenRevision
                            ? "existing"
                            : "new",
                      );
                      setDeleteItemsDraftSelectedId(
                        userOpenRevision?.id ?? null,
                      );
                      setDeleteItemsModal(true);
                    }}
                  >
                    Delete Selected ({selected.size})
                  </Button>
                )}
                <Tooltip
                  body={
                    isMerged
                      ? "You cannot edit a merged revision."
                      : isDiscarded
                        ? "You cannot edit a discarded revision."
                        : ""
                  }
                >
                  <Button
                    variant="ghost"
                    color="red"
                    disabled={!!(isMerged || isDiscarded)}
                    onClick={() => {
                      // When viewing live, switch to/create draft first
                      if (!selectedRevision && userOpenRevision) {
                        selectFlow(userOpenRevision);
                      }
                      setImportOperation("replace");
                      setAddItemsDraftMode(
                        !approvalRequired
                          ? "publish"
                          : userOpenRevision
                            ? "existing"
                            : "new",
                      );
                      setAddItemsDraftSelectedId(userOpenRevision?.id ?? null);
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
                        : ""
                  }
                >
                  <Button
                    variant="outline"
                    disabled={!!(isMerged || isDiscarded)}
                    onClick={() => {
                      // When viewing live, switch to/create draft first
                      if (!selectedRevision && userOpenRevision) {
                        selectFlow(userOpenRevision);
                      }
                      setImportOperation("append");
                      setAddItemsDraftMode(
                        !approvalRequired
                          ? "publish"
                          : userOpenRevision
                            ? "existing"
                            : "new",
                      );
                      setAddItemsDraftSelectedId(userOpenRevision?.id ?? null);
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
                        filteredValues.length > 0 &&
                        filteredValues.every((v) => selected.has(v))
                      }
                      setValue={(checked) => {
                        if (checked) {
                          setSelected(new Set(filteredValues));
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
                          Showing{" "}
                          {sortNewestFirst ? "newest first" : "oldest first"}
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
