import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { SavedGroupInterface } from "shared/types/saved-group";
import {
  Revision,
  applyTopLevelPatchOps,
  isSavedGroupRevisionMetadataOnly,
  getLiveRevision,
  getRevisionNumber,
} from "shared/enterprise";
import { REVIEW_REQUESTED_STATUSES } from "shared/validators";
import {
  PiArrowsDownUp,
  PiPencilSimpleFill,
  PiPlusCircleBold,
} from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { isIdListSupportedAttribute } from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";
import Markdown from "@/components/Markdown/Markdown";
import PageHead from "@/components/Layout/PageHead";
import Pagination from "@/components/Pagination";
import Frame from "@/ui/Frame";
import Metadata from "@/ui/Metadata";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import { draftStatusTooltip } from "@/components/Reviews/RevisionStatusBadge";
import EditRevisionDescriptionModal from "@/components/Reviews/EditRevisionDescriptionModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import SavedGroupForm from "@/components/SavedGroups/SavedGroupForm";
import SavedGroupArchiveModal from "@/components/SavedGroups/SavedGroupArchiveModal";
import SavedGroupDeleteModal from "@/components/SavedGroups/SavedGroupDeleteModal";
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
import ReviewAndPublishTab from "@/components/Revision/ReviewAndPublishTab";
import SavedGroupRevertModal from "@/components/Revision/SavedGroupRevertModal";
import RevisionSummaryCard from "@/components/Revision/RevisionSummaryCard";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import SavedGroupRevisionDropdown from "@/components/SavedGroups/SavedGroupRevisionDropdown";
import CompareSavedGroupRevisionsModal from "@/components/SavedGroups/CompareSavedGroupRevisionsModal";
import { useSavedGroupRevision } from "@/hooks/useSavedGroupRevision";
import { useSavedGroupReferences } from "@/hooks/useSavedGroupReferences";
import { REVISION_SAVED_GROUP_DIFF_CONFIG } from "@/components/Revision/RevisionDiffConfig";
import { useUser } from "@/services/UserContext";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import SavedGroupDraftSelectorForChanges, {
  DraftMode,
} from "@/components/SavedGroups/SavedGroupDraftSelectorForChanges";

const NUM_PER_PAGE = 10;

const savedGroupTabs = ["overview", "review"] as const;
type SavedGroupTab = (typeof savedGroupTabs)[number];

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
  const [tab, setTab] = useState<SavedGroupTab>("overview");
  const [compareRevisionsModalOpen, setCompareRevisionsModalOpen] =
    useState<boolean>(false);
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
  const [editDescriptionModal, setEditDescriptionModal] = useState(false);

  const settings = useOrgSettings();
  const { savedGroupSizeLimit, attributeSchema } = settings;
  const revertsBypassApproval = !!settings.revertsBypassApproval;

  const { references } = useSavedGroupReferences(savedGroup?.id);
  const referencingFeatures = references?.features ?? [];
  const referencingExperiments = references?.experiments ?? [];
  const referencingSavedGroups = references?.savedGroups ?? [];
  const totalReferences =
    referencingFeatures.length +
    referencingExperiments.length +
    referencingSavedGroups.length;

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

  // ── Page-level tabs: Overview | Review & Publish, driven by the URL hash.
  // The hash may carry a sub-tab after a comma (`#review,changes`); only the
  // first segment selects the page tab — the review tab reads the rest.
  useEffect(() => {
    const hash = (new URL(router.asPath, "http://x").hash
      .replace(/^#/, "")
      .split(",")[0] || undefined) as SavedGroupTab | undefined;
    if (hash && savedGroupTabs.includes(hash)) {
      setTab(hash);
    }
  }, [router.asPath]);
  const setTabAndScroll = (newTab: SavedGroupTab) => {
    setTab(newTab);
    router.replace(
      { pathname: router.pathname, query: router.query, hash: newTab },
      undefined,
      { shallow: true },
    );
  };

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

  // Count of active drafts awaiting/in review (pending-review, approved,
  // changes-requested) — drives the count bubble on the "Review & Publish"
  // tab, matching the feature header.
  const draftStatusCounts: Partial<Record<string, number>> = {};
  allRevisions.forEach((r) => {
    if ((REVIEW_REQUESTED_STATUSES as readonly string[]).includes(r.status)) {
      draftStatusCounts[r.status] = (draftStatusCounts[r.status] ?? 0) + 1;
    }
  });
  const activeDraftCount = Object.values(draftStatusCounts).reduce<number>(
    (sum, n) => sum + (n ?? 0),
    0,
  );

  // Per-revision approval gate: even when the org globally requires approval
  // for saved groups, a metadata-only revision can be published without
  // review when the `requireMetadataReview` setting is disabled. Mirrors the
  // server-side rule in the saved-group adapter so UI affordances (CTA copy,
  // publish button) match what the merge endpoint will actually allow.
  //
  // Reverts are NOT special-cased here (matching features): a revert saved as
  // a draft is gated by its content like any other change, so editing it still
  // requires review. Only the immediate "Publish Now" revert bypasses approval
  // (handled server-side in PUT /saved-groups via the revert-bypass shortcut).
  const selectedRevisionRequiresApproval =
    !!selectedRevision &&
    approvalRequired &&
    (metadataReviewRequired ||
      !isSavedGroupRevisionMetadataOnly(
        selectedRevision.target.proposedChanges,
      ));

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
    ? [...filteredValues].reverse()
    : filteredValues;

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const valuesPage = sortedValues.slice(start, end);
  const { user } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const canUpdate = savedGroup
    ? permissionsUtil.canUpdateSavedGroup(savedGroup, savedGroup)
    : false;

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
        ? [...new Set(itemsToAdd.concat(displayedValues))].length >
          savedGroupSizeLimit
        : false,
    [savedGroupSizeLimit, itemsToAdd, displayedValues],
  );
  const displayRevision = useMemo(
    // For live (no explicit selection), use the latest merged revision.
    () => selectedRevision ?? getLiveRevision(allRevisions),
    [selectedRevision, allRevisions],
  );

  const revisionNumber = useMemo(
    () =>
      getRevisionNumber(
        allRevisions,
        selectedRevision ?? userOpenRevision ?? displayRevision,
      ),
    [selectedRevision, userOpenRevision, displayRevision, allRevisions],
  );

  if (error) {
    return (
      <Callout status="error" mt="4">
        An error occurred: {error.message}
      </Callout>
    );
  }

  if (!data || !savedGroup) {
    return <LoadingOverlay />;
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
          useRadixButton={false}
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
          useRadixButton={false}
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
      {confirmRevert && revisionToRevert && (
        <SavedGroupRevertModal
          savedGroup={savedGroup}
          revision={revisionToRevert}
          allRevisions={allRevisions}
          diffConfig={REVISION_SAVED_GROUP_DIFF_CONFIG}
          revertsBypassApproval={revertsBypassApproval}
          approvalRequired={approvalRequired}
          canBypassApproval={!!canAdminPublish}
          close={() => {
            setConfirmRevert(false);
            setRevisionToRevert(null);
          }}
          onRevisionCreated={(rev) => {
            onRevisionCreated(rev);
            setConfirmRevert(false);
            setRevisionToRevert(null);
          }}
        />
      )}
      {compareRevisionsModalOpen && (
        <CompareSavedGroupRevisionsModal
          savedGroup={savedGroup}
          allRevisions={allRevisions}
          currentRevisionId={selectedRevisionId}
          onClose={() => setCompareRevisionsModalOpen(false)}
          initialPreviewDraft={
            isDraft && selectedRevisionId ? selectedRevisionId : undefined
          }
          initialMode={isLive && !isDraft ? "most-recent-live" : undefined}
          requiresApproval={approvalRequired}
        />
      )}
      {editDescriptionModal && displayRevision && (
        <EditRevisionDescriptionModal
          initialValue={displayRevision.comment || ""}
          close={() => setEditDescriptionModal(false)}
          onSubmit={async (description) => {
            await apiCall(`/revision/${displayRevision.id}/description`, {
              method: "PATCH",
              body: JSON.stringify({ description }),
            });
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
        <Box mb="4">
          <Tabs
            value={tab}
            onValueChange={(v) => setTabAndScroll(v as SavedGroupTab)}
          >
            <TabsList size="3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="review">
                Review &amp; Publish
                {activeDraftCount > 0 && (
                  <Tooltip body={draftStatusTooltip(draftStatusCounts)}>
                    <Badge
                      label={String(activeDraftCount)}
                      color="red"
                      variant="solid"
                      radius="full"
                      ml="2"
                      style={{ minWidth: 18, height: 18 }}
                    />
                  </Tooltip>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </Box>
        {tab === "review" && (
          <ReviewAndPublishTab<SavedGroupInterface>
            // When viewing "live" (no explicit selection) fall back to the
            // live revision — the latest merged one — so the tab renders its
            // read-only Live view (Live badge + Roll back) instead of the
            // "select a revision" empty state, matching the feature flow.
            revision={selectedRevision ?? displayRevision ?? null}
            allRevisions={allRevisions}
            currentState={savedGroup}
            diffConfig={REVISION_SAVED_GROUP_DIFF_CONFIG}
            entityName={savedGroup.groupName}
            entityNoun="saved group"
            // Defer to the per-revision gate so metadata-only revisions skip
            // the review dance when `requireMetadataReview` is off (matching
            // the server-side rule in the saved-group adapter).
            requiresApproval={selectedRevisionRequiresApproval}
            canEditEntity={permissionsUtil.canUpdateSavedGroup(savedGroup, {})}
            canBypassApproval={!!canAdminPublish}
            selectRevision={selectFlow}
            onPublish={handlePublish}
            onDiscard={handleDiscard}
            onReopen={handleReopen}
            onRevert={(rev) => {
              setRevisionToRevert(rev);
              setConfirmRevert(true);
            }}
            onCompareRevisions={
              allRevisions.length >= 2
                ? () => setCompareRevisionsModalOpen(true)
                : undefined
            }
            mutate={async () => {
              await Promise.all([mutateRevisions(), mutate()]);
            }}
          />
        )}
        {tab === "overview" && (
          <>
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
                                projects.find((proj) => proj.id === p)?.name ||
                                p,
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
              <Box mb="3">
                <Markdown>{displayedSavedGroup.description}</Markdown>
              </Box>
            )}
            {savedGroup.type === "list" &&
              !isIdListSupportedAttribute(attr) && (
                <Callout status="error" mt="3">
                  The attribute for this saved group has an unsupported
                  datatype. It cannot be edited and it may produce unexpected
                  behavior when used in SDKs. Try using a{" "}
                  <Link href="/saved-groups#conditionGroups">
                    Condition Group
                  </Link>{" "}
                  instead
                </Callout>
              )}
            <RevisionSummaryCard
              allRevisions={allRevisions}
              selectedRevision={selectedRevision}
              entityNoun="saved group"
              hasRevisions={hasRevisions}
              canEditTitle={canUpdate}
              canEditDescription={canUpdate}
              fallbackOwnerId={savedGroup.owner}
              fallbackDateCreated={savedGroup.dateCreated}
              onSelectRevision={selectFlow}
              onTitleCommit={async (revisionId, title) => {
                await apiCall(`/revision/${revisionId}/title`, {
                  method: "PATCH",
                  body: JSON.stringify({ title }),
                });
                await mutateRevisions();
              }}
              onNewDraft={() => setConfirmNewDraft(true)}
              onReviewPublish={() => setTabAndScroll("review")}
              onEditDescription={() => setEditDescriptionModal(true)}
            />
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
                                    .snapshot as SavedGroupInterface) ||
                                    savedGroup,
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
                          setAddItemsDraftSelectedId(
                            userOpenRevision?.id ?? null,
                          );
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
                        icon={<PiPlusCircleBold />}
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
                          setAddItemsDraftSelectedId(
                            userOpenRevision?.id ?? null,
                          );
                          setAddItems(true);
                        }}
                      >
                        Add items
                      </Button>
                    </Tooltip>
                  </Flex>
                </Flex>

                <Table variant="list" stickyHeader={false}>
                  <TableHeader>
                    <TableRow>
                      <TableColumnHeader style={{ width: "48px" }}>
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
                      </TableColumnHeader>
                      <TableColumnHeader>
                        <Flex justify="between" align="center">
                          <span>{savedGroup.attributeKey}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<PiArrowsDownUp />}
                            onClick={() => {
                              setSortNewestFirst(!sortNewestFirst);
                              setCurrentPage(1);
                            }}
                          >
                            Showing{" "}
                            {sortNewestFirst ? "newest first" : "oldest first"}
                          </Button>
                        </Flex>
                      </TableColumnHeader>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {valuesPage.map((value) => {
                      return (
                        <TableRow
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
                          <TableCell onClick={(e) => e.stopPropagation()}>
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
                          </TableCell>
                          <TableCell>{value}</TableCell>
                        </TableRow>
                      );
                    })}
                    {!displayedValues.length && (
                      <TableRow>
                        <TableCell colSpan={2}>
                          This group doesn&apos;t have any items yet
                        </TableCell>
                      </TableRow>
                    )}
                    {displayedValues.length && !filteredValues.length ? (
                      <TableRow>
                        <TableCell colSpan={2}>No matching items</TableCell>
                      </TableRow>
                    ) : (
                      <></>
                    )}
                  </TableBody>
                </Table>
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
                      This saved group has legacy behavior when empty and will
                      be completely ignored when used for targeting.{" "}
                      <DocLink useRadix={false} docSection="idLists">
                        Learn More
                      </DocLink>
                    </Callout>
                  )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
