import {
  NO_ENVIRONMENT_BINDING,
  canCommentOnRevisionEntity,
  canLandArchiveToggle,
  canLandRevertToTarget,
  canPublishRevisionEntity,
  canReviewRevisionEntity,
  canStageArchiveDraft,
  holdsRevisionDestination,
} from "shared/permissions";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { SavedGroupInterface } from "shared/types/saved-group";
import {
  Revision,
  applyTopLevelPatchOps,
  getLiveRevision,
  getRevisionNumberById,
  isSavedGroupRevisionMetadataOnly,
  isSavedGroupRevisionArchiveOnly,
  getApprovalFlowRules,
  getApprovalFlowSettings,
  isRevisionEditLockedBySchedule,
} from "shared/enterprise";
import { isActiveDraftStatus } from "shared/validators";
import { PiPlus } from "react-icons/pi";
import { isIdListSupportedAttribute, restoredProjectScope } from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";
import PageHead from "@/components/Layout/PageHead";
import Pagination from "@/ui/Pagination";
import SectionFrame from "@/components/SectionFrame";
import Text from "@/ui/Text";
import { SortButton, ariaSort } from "@/services/search";
import Badge from "@/ui/Badge";
import ArchiveStateCallout from "@/components/Revision/ArchiveStateCallout";
import Tooltip from "@/ui/Tooltip";
import { SCHEDULE_EDIT_LOCK_REASON } from "@/components/Features/ScheduleLock";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import SavedGroupForm from "@/components/SavedGroups/SavedGroupForm";
import SavedGroupArchiveModal from "@/components/SavedGroups/SavedGroupArchiveModal";
import SavedGroupDeleteModal from "@/components/SavedGroups/SavedGroupDeleteModal";
import Modal from "@/components/Modal";
import LoadingOverlay from "@/components/LoadingOverlay";
import { IdListItemInput } from "@/components/SavedGroups/IdListItemInput";
import LargeSavedGroupPerformanceWarning, {
  useLargeSavedGroupSupport,
} from "@/components/SavedGroups/LargeSavedGroupSupportWarning";
import RemoteSavedGroupUploads from "@/components/SavedGroups/RemoteSavedGroupUploads";
import RemoteSavedGroupSetupCallout from "@/components/SavedGroups/RemoteSavedGroupSetupCallout";
import useOrgSettings from "@/hooks/useOrgSettings";
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
import UpgradeModal from "@/components/Settings/UpgradeModal";
import Button from "@/ui/Button";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { savedGroupReferenceSections } from "@/components/SavedGroups/SavedGroupReferencesList";
import Checkbox from "@/ui/Checkbox";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import ReviewAndPublishTab from "@/components/Revision/ReviewAndPublishTab";
import SavedGroupRevertModal from "@/components/Revision/SavedGroupRevertModal";
import RevisionDropdown from "@/components/Revision/RevisionDropdown";
import RevisionStatusBar, {
  hasRevisionStatus,
} from "@/components/Revision/RevisionStatusBar";
import { getStatusBadge } from "@/components/Revision/revisionUtils";
import RevisionLabel from "@/components/Reviews/RevisionLabel";
import NewDraftButton from "@/components/Reviews/NewDraftButton";
import { useRevisionStatusBarHeight } from "@/components/Reviews/RevisionStatusBarView";
import { TabsTrigger } from "@/ui/Tabs";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import CompareSavedGroupRevisionsModal from "@/components/SavedGroups/CompareSavedGroupRevisionsModal";
import { useSavedGroupRevision } from "@/hooks/useSavedGroupRevision";
import { useSavedGroupReferences } from "@/hooks/useSavedGroupReferences";
import { REVISION_SAVED_GROUP_DIFF_CONFIG } from "@/components/Revision/RevisionDiffConfig";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import HelperText from "@/ui/HelperText";
import ConflictCallout, {
  ConflictProvider,
  ConflictShell,
} from "@/components/DraftConflicts/ConflictContext";
import { useDraftConflict } from "@/components/DraftConflicts/useDraftConflict";
import SavedGroupDraftSelectorForChanges, {
  DraftMode,
} from "@/components/SavedGroups/SavedGroupDraftSelectorForChanges";
import SavedGroupDetailsPanel from "@/components/SavedGroups/SavedGroupDetailsPanel";
import { DetailsPanelLayout, useDetailsPanel } from "@/components/DetailsPanel";
import {
  DetailsPageActions,
  DetailsPageMenu,
  DetailsPageTabs,
  DetailsPageTitleBar,
  REVISION_SELECTOR_WIDTH_PX,
  ReviewTabCount,
  TabCount,
} from "@/components/Layout/DetailsPageHeader";
import { useTabsBottom } from "@/components/Layout/pageTopOffset";
import { draftModeCta } from "@/components/DraftSelector";

const NUM_PER_PAGE = 10;

const savedGroupTabs = ["overview", "review"] as const;
type SavedGroupTab = (typeof savedGroupTabs)[number];

const REMOTE_LOCKED_REASON = "Changing Remote Groups needs an Enterprise plan.";

export default function EditSavedGroupPage() {
  const router = useRouter();
  const { sgid } = router.query;
  const { data, error, mutate } = useApi<{ savedGroup: SavedGroupInterface }>(
    `/saved-groups/${sgid}`,
  );
  const savedGroup = data?.savedGroup;
  const [newestFirst, setNewestFirst] = useState(true);
  const [addItems, setAddItems] = useState<boolean>(false);
  const [itemsToAdd, setItemsToAdd] = useState<string[]>([]);
  const [showAuditModal, setShowAuditModal] = useState<boolean>(false);
  const [tab, setTab] = useState<SavedGroupTab>("overview");
  const [compareRevisionsModalOpen, setCompareRevisionsModalOpen] =
    useState<boolean>(false);
  const [upgradeModal, setUpgradeModal] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const [adminBypassSizeLimit, setAdminBypassSizeLimit] = useState(false);
  const [addItemsDraftMode, setAddItemsDraftMode] = useState<DraftMode>("new");
  const [addItemsDraftSelectedId, setAddItemsDraftSelectedId] = useState<
    string | null
  >(null);
  // Live list pinned at modal open; the SWR value revalidates mid-edit, so a
  // submit-time read would vouch for changes the user never saw.
  const [liveListPin, setLiveListPin] = useState<string[] | null>(null);
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

  const settings = useOrgSettings();
  const { savedGroupSizeLimit, attributeSchema } = settings;
  const revertsBypassApproval = !!settings.revertsBypassApproval;

  const {
    references,
    loading: referencesLoading,
    error: referencesError,
  } = useSavedGroupReferences(savedGroup?.id);

  const [currentPage, setCurrentPage] = useState(1);
  const [filter, setFilter] = useState("");

  const { apiCall } = useAuth();
  const [importOperation, setImportOperation] = useState<"replace" | "append">(
    "replace",
  );

  const approvalFlow = getApprovalFlowSettings(
    settings.approvalFlows,
    "saved-group",
    savedGroup?.projects ?? [],
  );
  // Raw governing rules, mirroring the server adapter: the resolved policy
  // deliberately drops team requirements, but the review tab needs them.
  const approvalFlowRules = getApprovalFlowRules(
    settings.approvalFlows,
    "saved-group",
    savedGroup?.projects ?? [],
  ).filter((r) => r.required);
  const approvalRequired = !!approvalFlow?.required;
  const metadataReviewRequired =
    approvalRequired && (approvalFlow?.requireMetadataReview ?? true);

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
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const details = useDetailsPanel({
    openKey: `saved-group-details-panel-open__${sgid}`,
    widthKey: "saved-group-details-panel-width",
    tab,
    homeTab: "overview",
  });
  const tabsBottom = useTabsBottom();
  const [setStatusBarEl, statusBarHeight] = useRevisionStatusBarHeight();

  // Revision state variables for UI logic
  const isLive = !selectedRevision;
  const isDraft =
    !!selectedRevision && isActiveDraftStatus(selectedRevision.status);
  const isDiscarded =
    selectedRevision && selectedRevision.status === "discarded";
  const isMerged = selectedRevision && selectedRevision.status === "merged";

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

  // A list can't merge item-by-item, so a contested one is flagged, not merged.
  // One instance per modal, so an add conflict can't gate a later removal.
  const addConflict = useDraftConflict<Record<string, unknown>>({
    initial: { values: displayedValues },
    labels: { values: "List items" },
    applyField: (_field, value) => {
      setImportOperation("replace");
      setItemsToAdd((value as string[]) ?? []);
    },
    isNewDraft: addItemsDraftMode === "new",
    entityNoun: "saved group",
    onReload: async () => {
      await mutate();
      setAddItems(false);
      setItemsToAdd([]);
    },
  });
  // Removing by selection has nowhere to apply their list, so this one only
  // reports the conflict and offers a reload.
  const deleteConflict = useDraftConflict<Record<string, unknown>>({
    initial: { values: displayedValues },
    labels: { values: "List items" },
    isNewDraft: deleteItemsDraftMode === "new",
    entityNoun: "saved group",
  });

  // Publish/new-draft submits compare against live, which the hook baseline
  // only describes when the conflict itself came from live.
  const submitBaseline = (
    mode: DraftMode,
    guardBaseline: Record<string, unknown> | undefined,
    hook: { hasConflict: boolean; conflictFromDraft: boolean },
  ) =>
    mode !== "existing" && (!hook.hasConflict || hook.conflictFromDraft)
      ? { values: liveListPin ?? savedGroup?.values }
      : guardBaseline;

  const filteredValues = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return term
      ? displayedValues.filter((v) => v.toLowerCase().includes(term))
      : displayedValues;
  }, [displayedValues, filter]);
  const positions = useMemo(
    () => new Map(displayedValues.map((v, i) => [v, i + 1])),
    [displayedValues],
  );
  const sortedValues = useMemo(
    () => (newestFirst ? [...filteredValues].reverse() : filteredValues),
    [filteredValues, newestFirst],
  );

  const page = Math.min(
    currentPage,
    Math.max(1, Math.ceil(sortedValues.length / NUM_PER_PAGE)),
  );
  const start = (page - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const valuesPage = sortedValues.slice(start, end);
  const { user, hasCommercialFeature } = useUser();
  // Without Enterprise, a Remote Group keeps working but can't be changed
  const remoteLocked =
    savedGroup?.type === "remote" &&
    !hasCommercialFeature("large-saved-groups");
  const permissionsUtil = usePermissionsUtil();
  const canDraft =
    savedGroup && !remoteLocked
      ? permissionsUtil.canRevisionAction(
          "saved-group",
          "draft",
          savedGroup,
          NO_ENVIRONMENT_BINDING,
        )
      : false;
  // Reverting is its own authority — a revert-only role holds no draft or
  // publish rights, and revert alone is enough to both propose and land one.
  const canRevertEntity = savedGroup
    ? permissionsUtil.canRevisionAction(
        "saved-group",
        "revert",
        savedGroup,
        NO_ENVIRONMENT_BINDING,
      )
    : false;

  // Archive controls use live state and allow either landing or draft authority.
  const isArchivedInView = !!savedGroup?.archived;
  const canToggleArchive =
    !!savedGroup &&
    (canLandArchiveToggle(
      permissionsUtil,
      "saved-group",
      savedGroup,
      NO_ENVIRONMENT_BINDING,
    ) ||
      canStageArchiveDraft({
        permissions: permissionsUtil,
        model: "saved-group",
        entity: savedGroup,
        archived: !isArchivedInView,
      }));

  const canAdminPublish =
    !!approvalRequired &&
    !!savedGroup?.id &&
    (user?.role === "admin" ||
      (savedGroup?.projects?.length
        ? savedGroup.projects.every((project) =>
            permissionsUtil.canBypassSavedGroupApprovalChecks({
              project: project || "",
            }),
          )
        : permissionsUtil.canBypassSavedGroupApprovalChecks({ project: "" })));

  // Publishing is its own authority: an author without it edits through drafts
  // and is never offered "publish now" — the server refuses that write.
  const canAutoPublish =
    !!savedGroup &&
    permissionsUtil.canRevisionAction("saved-group", "publish", savedGroup) &&
    (!approvalRequired || canAdminPublish);

  const largeSavedGroupSupport = useLargeSavedGroupSupport();

  const [focusDescription, setFocusDescription] = useState(false);
  const [savedGroupForm, setSavedGroupForm] =
    useState<null | Partial<SavedGroupInterface>>(null);
  const [editConditionModal, setEditConditionModal] =
    useState<null | Partial<SavedGroupInterface>>(null);
  const [useUploadModal, setUseUploadModal] = useState<null | {
    version: number;
    current: Partial<SavedGroupInterface>;
  }>(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const attr = (attributeSchema || []).find(
    (attr) => attr.property === savedGroup?.attributeKey,
  );

  const liveRevision = useMemo(
    () => getLiveRevision(allRevisions) ?? null,
    [allRevisions],
  );
  const panelRevision = selectedRevision ?? liveRevision;

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

  const toggleSelected = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setSelected(next);
  };
  const stateOf = (revision: Revision | null | undefined) =>
    revision
      ? (applyTopLevelPatchOps(
          (revision.target.snapshot as SavedGroupInterface) || savedGroup,
          revision.target.proposedChanges,
        ) as SavedGroupInterface)
      : savedGroup;
  // Edits go to the viewed draft, else your open draft, else a new one.
  const editTarget =
    selectedRevision ??
    (userOpenRevision && !isRevisionEditLockedBySchedule(userOpenRevision)
      ? userOpenRevision
      : null);
  const itemsBase = (mode: DraftMode, draftId: string | null) =>
    (mode === "existing"
      ? stateOf(openRevisions.find((r) => r.id === draftId))
      : savedGroup
    ).values ?? [];
  const replacedCount = itemsBase(
    addItemsDraftMode,
    addItemsDraftSelectedId,
  ).length;
  // Counted on the list the add writes to: an append keeps the target's items.
  const listAboveSizeLimit =
    addItems &&
    !!savedGroupSizeLimit &&
    new Set([
      ...(importOperation === "append"
        ? itemsBase(addItemsDraftMode, addItemsDraftSelectedId)
        : []),
      ...itemsToAdd,
    ]).size > savedGroupSizeLimit;
  const addCta = draftModeCta(addItemsDraftMode, {
    bypassesApproval: approvalRequired && canAdminPublish,
  });
  const removeCta = draftModeCta(deleteItemsDraftMode, {
    bypassesApproval: approvalRequired && canAdminPublish,
  });
  const openItemsModal = (operation: "replace" | "append") => {
    setImportOperation(operation);
    setAddItemsDraftMode(editTarget ? "existing" : "new");
    setAddItemsDraftSelectedId(editTarget?.id ?? null);
    setLiveListPin(savedGroup.values ?? []);
    addConflict.clear({ values: stateOf(editTarget).values ?? [] });
    setAddItems(true);
  };

  const canEditView = canDraft && !isMerged && !isDiscarded;
  const editLockReason =
    selectedRevision &&
    isDraft &&
    isRevisionEditLockedBySchedule(selectedRevision)
      ? SCHEDULE_EDIT_LOCK_REASON
      : null;
  const editBlockedReason = isMerged
    ? "You cannot edit a published revision."
    : isDiscarded
      ? "You cannot edit a discarded revision."
      : !canDraft
        ? "You don't have permission to edit drafts for this Saved Group."
        : null;
  const editInfoBlockedReason = remoteLocked
    ? REMOTE_LOCKED_REASON
    : editLockReason;
  const editInfo =
    (canDraft || remoteLocked) && !isMerged && !isDiscarded
      ? (focus?: "description") => {
          setFocusDescription(focus === "description");
          setSavedGroupForm(stateOf(selectedRevision));
        }
      : null;

  const canManageDrafts = permissionsUtil.canRevisionAction(
    "saved-group",
    "draft",
    savedGroup,
  );
  const canPublishFromBar =
    canPublishRevisionEntity(
      permissionsUtil,
      "saved-group",
      selectedRevision,
      savedGroup,
      NO_ENVIRONMENT_BINDING,
    ) &&
    (!remoteLocked ||
      isSavedGroupRevisionArchiveOnly(
        selectedRevision?.target.proposedChanges,
      ));

  const showsStatusBar =
    tab === "overview" &&
    hasRevisionStatus(selectedRevision, liveRevision, allRevisions);
  const stickyTop = tabsBottom + (showsStatusBar ? statusBarHeight : 0);

  const revisionNumbers = getRevisionNumberById(allRevisions);
  const newDraft = canDraft ? (
    <NewDraftButton
      entityNoun="Saved Group"
      activeDraftCount={openRevisions.length}
      nextVersion={Math.max(0, ...revisionNumbers.values()) + 1}
      basedOn={
        liveRevision ? (
          <>
            <Text as="span" size="inherit" weight="semibold" color="text-high">
              <RevisionLabel
                version={revisionNumbers.get(liveRevision.id) ?? 1}
                title={liveRevision.title}
                numbered={!!liveRevision.title}
                minWidth={0}
                numberSize="inherit"
              />
            </Text>{" "}
            {getStatusBadge("live", approvalRequired)}
          </>
        ) : (
          <>the live Saved Group</>
        )
      }
      create={async ({ title, comment }) => {
        const params = new URLSearchParams();
        params.set("forceCreateRevision", "1");
        if (title) params.set("title", title);
        const res = await apiCall<{ revision?: Revision }>(
          `/saved-groups/${savedGroup.id}?${params.toString()}`,
          { method: "PUT", body: JSON.stringify({}) },
        );
        const revision = res?.revision;
        if (!revision) return;
        if (comment) {
          await apiCall(`/revision/${revision.id}/description`, {
            method: "PATCH",
            body: JSON.stringify({ description: comment }),
          });
        }
        await Promise.all([mutateRevisions(), mutate()]);
        selectFlow(revision);
      }}
    />
  ) : null;

  const canDeleteNow =
    savedGroup.archived && permissionsUtil.canDeleteSavedGroup(savedGroup);
  const menu = (
    <DetailsPageMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
      <DropdownMenuGroup>
        <DropdownMenuItem
          onClick={() => {
            setDropdownOpen(false);
            setShowAuditModal(true);
          }}
        >
          Audit history
        </DropdownMenuItem>
        {allRevisions.length >= 2 && (
          <DropdownMenuItem
            onClick={() => {
              setDropdownOpen(false);
              setCompareRevisionsModalOpen(true);
            }}
          >
            Compare revisions
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      {(canToggleArchive || canDeleteNow) && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {canToggleArchive && (
              <DropdownMenuItem
                onClick={() => {
                  setDropdownOpen(false);
                  setShowArchiveModal(true);
                }}
              >
                {isArchivedInView ? "Unarchive" : "Archive"}
              </DropdownMenuItem>
            )}
            {/* Gated on the LIVE archive state, as the server is: publish the
                archive before deleting. */}
            {canDeleteNow && (
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
        </>
      )}
    </DetailsPageMenu>
  );

  return (
    <>
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
              {
                event: "savedGroup.uploaded",
                getLabel: () => "Uploaded IDs",
                alwaysVisible: true,
              },
              {
                event: "savedGroup.uploadDeleted",
                getLabel: () => "Deleted an upload",
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
          header={`Remove ${selected.size} Item${selected.size !== 1 ? "s" : ""}`}
          cta={removeCta.label}
          submitColor={removeCta.bypass ? "danger" : "primary"}
          ctaEnabled={!deleteConflict.hasConflict}
          disabledMessage={
            deleteConflict.hasConflict
              ? "Reload to remove items from the current list."
              : undefined
          }
          submit={async () => {
            if (deleteConflict.hasConflict) return;
            const newValues = itemsBase(
              deleteItemsDraftMode,
              deleteItemsDraftSelectedId,
            ).filter((v) => !selected.has(v));

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

            const guard = deleteConflict.guard({ values: newValues });
            const baseline = submitBaseline(
              deleteItemsDraftMode,
              guard.baseline,
              deleteConflict,
            );
            const res = await deleteConflict.guarded(() =>
              apiCall<{
                status: number;
                revision?: Revision;
              }>(
                `/saved-groups/${savedGroup.id}?${params.toString()}`,
                {
                  method: "PUT",
                  body: JSON.stringify({
                    values: newValues,
                    baseline,
                  }),
                },
                guard.onError,
              ),
            );
            deleteConflict.clear();

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
            alert={
              deleteConflict.hasConflict ? (
                <HelperText status="warning" icon={null}>
                  The list changed while you were editing, so this removal no
                  longer matches it.
                </HelperText>
              ) : undefined
            }
            alertActive={deleteConflict.hasConflict}
          />
          {deleteConflict.hasConflict && (
            <ConflictShell
              resolved={false}
              message={
                <Text>Reload to remove items from the current list.</Text>
              }
              choices={
                <Button
                  size="sm"
                  onClick={async () => {
                    deleteConflict.clear();
                    setSelected(new Set());
                    await mutate();
                    setDeleteItemsModal(false);
                  }}
                >
                  Reload
                </Button>
              }
            />
          )}
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
          cta={addCta.label}
          submitColor={addCta.bypass ? "danger" : "primary"}
          ctaEnabled={
            itemsToAdd.length > 0 &&
            (!listAboveSizeLimit || adminBypassSizeLimit) &&
            addConflict.resolved
          }
          submit={async () => {
            const newValues =
              importOperation === "append"
                ? [
                    ...new Set([
                      ...itemsBase(addItemsDraftMode, addItemsDraftSelectedId),
                      ...itemsToAdd,
                    ]),
                  ]
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

            const guard = addConflict.guard({ values: newValues });
            const baseline = submitBaseline(
              addItemsDraftMode,
              guard.baseline,
              addConflict,
            );
            const res = await addConflict.guarded(() =>
              apiCall<{
                status: number;
                requiresApproval?: boolean;
                revision?: Revision;
              }>(
                `/saved-groups/${savedGroup.id}?${params.toString()}`,
                {
                  method: "PUT",
                  body: JSON.stringify({
                    values: newValues,
                    baseline,
                  }),
                },
                guard.onError,
              ),
            );
            addConflict.clear();

            if (res?.revision) {
              onRevisionCreated(res.revision);
            } else {
              mutate();
            }
            setItemsToAdd([]);
          }}
        >
          <ConflictProvider {...addConflict.providerProps}>
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
              alert={addConflict.alert}
              alertActive={addConflict.alertActive}
            />
            {importOperation === "replace" && replacedCount > 0 ? (
              <Text as="p" mb="3">
                These replace all {replacedCount} current item
                {replacedCount === 1 ? "" : "s"}.
              </Text>
            ) : null}
            <IdListItemInput
              values={itemsToAdd}
              setValues={(newValues) => setItemsToAdd(newValues)}
              listAboveSizeLimit={listAboveSizeLimit}
              bypassSizeLimit={adminBypassSizeLimit}
              setBypassSizeLimit={setAdminBypassSizeLimit}
              projects={savedGroup.projects}
            />
            <ConflictCallout field="values" />
          </ConflictProvider>
        </Modal>
      )}
      {savedGroupForm && (
        <SavedGroupForm
          close={() => {
            setSavedGroupForm(null);
            mutate();
          }}
          current={savedGroupForm}
          focusDescription={focusDescription}
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
          // Seeds from the draft it writes to, which the page may not be viewing.
          selectedRevision={editTarget}
          onSelectRevision={selectFlow}
          liveVersion={savedGroup}
          editConditionOnly={true}
          mutate={async () => {
            await Promise.all([mutateRevisions(), mutate()]);
          }}
        />
      )}
      {useUploadModal && (
        <SavedGroupForm
          close={() => {
            setUseUploadModal(null);
            mutate();
          }}
          current={useUploadModal.current}
          type={savedGroup.type}
          approvalFlowRequired={approvalRequired}
          metadataReviewRequired={metadataReviewRequired}
          onRevisionCreated={onRevisionCreated}
          openRevisions={openRevisions}
          allRevisions={allRevisions}
          selectedRevision={selectedRevision}
          onSelectRevision={selectFlow}
          liveVersion={savedGroup}
          useUploadVersion={useUploadModal.version}
          mutate={async () => {
            await Promise.all([mutateRevisions(), mutate()]);
          }}
        />
      )}
      {showArchiveModal && displayedSavedGroup && (
        <SavedGroupArchiveModal
          // LIVE state, like the feature page does: the endpoint flips against
          // live, so handing the revision-PROJECTED Saved Group here inverted the
          // action whenever the viewed draft staged the opposite archive state —
          // the modal predicted one atom and submitted the other, and the endpoint
          // saw no transition at all and wrote nothing.
          savedGroup={savedGroup}
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
      {confirmRevert && revisionToRevert && (
        <SavedGroupRevertModal
          canRevert={canRevertEntity}
          // Recomputed per target: restoring an older snapshot can relocate the
          // group, and the destination is judged on the state being restored.
          canLandRevertForTarget={(t) =>
            canLandRevertToTarget(
              permissionsUtil,
              "saved-group",
              savedGroup,
              restoredProjectScope(t),
              NO_ENVIRONMENT_BINDING,
            )
          }
          canDraft={canDraft}
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
      <PageHead
        breadcrumb={[
          { display: "Saved Groups", href: "/saved-groups" },
          { display: displayedSavedGroup?.groupName || savedGroup.groupName },
        ]}
      />

      <DetailsPageTitleBar
        title={displayedSavedGroup?.groupName || savedGroup.groupName}
        onRename={editInfo}
        renameBlockedReason={editInfoBlockedReason}
        badges={
          savedGroup.archived ? <Badge label="Archived" color="gray" /> : null
        }
        actions={
          <DetailsPageActions
            // A draft's way to review is on the status bar under the tabs.
            newDraft={isDraft ? null : newDraft}
            menu={menu}
          />
        }
      >
        <ArchiveStateCallout
          noun="Saved Group"
          liveArchived={!!savedGroup.archived}
          viewedArchived={!!displayedSavedGroup?.archived}
        />
      </DetailsPageTitleBar>

      <DetailsPageTabs
        value={tab}
        onValueChange={(v) => setTabAndScroll(v as SavedGroupTab)}
        triggers={
          <>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="review">
              Review &amp; Publish
              <ReviewTabCount statuses={allRevisions.map((r) => r.status)} />
            </TabsTrigger>
          </>
        }
        revisionPicker={
          <RevisionDropdown
            entityId={savedGroup.id}
            allRevisions={allRevisions}
            selectedRevisionId={selectedRevisionId}
            onSelectRevision={selectFlow}
            requiresApproval={approvalRequired}
            context="header"
            width={REVISION_SELECTOR_WIDTH_PX}
          />
        }
        detailsOpen={details.open}
        setDetailsOpen={details.toggle}
        statusBar={
          showsStatusBar ? (
            <div ref={setStatusBarEl}>
              <RevisionStatusBar<SavedGroupInterface>
                selectedRevision={selectedRevision}
                liveRevision={liveRevision}
                allRevisions={allRevisions}
                liveSnapshot={savedGroup}
                diffConfig={REVISION_SAVED_GROUP_DIFF_CONFIG}
                entityNoun="Saved Group"
                requiresApproval={selectedRevisionRequiresApproval}
                canDiscard={
                  canManageDrafts || selectedRevision?.authorId === user?.id
                }
                onSelectRevision={selectFlow}
                onReviewPublish={() => setTabAndScroll("review")}
                onPublish={canPublishFromBar ? handlePublish : null}
                onDiscard={handleDiscard}
              />
            </div>
          ) : null
        }
      />

      <DetailsPanelLayout
        details={details}
        stickyTop={stickyTop}
        panel={
          <SavedGroupDetailsPanel
            savedGroup={displayedSavedGroup ?? savedGroup}
            onEditInfo={editInfo}
            editInfoBlockedReason={editInfoBlockedReason}
            references={{
              rows: savedGroupReferenceSections(references ?? {}),
              loading: referencesLoading,
              error: !!referencesError,
            }}
            revision={panelRevision}
            allRevisions={allRevisions}
            isLive={isLive}
            requiresApproval={approvalRequired}
            canEditRevision={canDraft}
            onRenameRevision={async (title) => {
              if (!selectedRevision) return;
              await apiCall(`/revision/${selectedRevision.id}/title`, {
                method: "PATCH",
                body: JSON.stringify({ title }),
              });
              await mutateRevisions();
            }}
            onDescribeRevision={async (description) => {
              if (!selectedRevision) return;
              await apiCall(`/revision/${selectedRevision.id}/description`, {
                method: "PATCH",
                body: JSON.stringify({ description }),
              });
              await mutateRevisions();
            }}
          />
        }
      >
        <div className="details-column">
          <Box className="contents container-fluid pagecontents">
            {tab === "review" && (
              <ReviewAndPublishTab<SavedGroupInterface>
                // When viewing "live" (no explicit selection) fall back to the
                // live revision — the latest merged one — so the tab renders its
                // read-only Live view (Live badge + Roll back) instead of the
                // "select a revision" empty state, matching the feature flow.
                revision={panelRevision}
                allRevisions={allRevisions}
                currentState={savedGroup}
                diffConfig={REVISION_SAVED_GROUP_DIFF_CONFIG}
                entityName={savedGroup.groupName}
                entityNoun="Saved Group"
                // Defer to the per-revision gate so metadata-only revisions skip
                // the review dance when `requireMetadataReview` is off (matching
                // the server-side rule in the saved-group adapter).
                requiresApproval={selectedRevisionRequiresApproval}
                reviewRules={approvalFlowRules}
                canEditEntity={permissionsUtil.canRevisionAction(
                  "saved-group",
                  "draft",
                  savedGroup,
                  NO_ENVIRONMENT_BINDING,
                )}
                canRevertEntity={permissionsUtil.canRevisionAction(
                  "saved-group",
                  "revert",
                  savedGroup,
                )}
                canDeleteEntity={permissionsUtil.canRevisionAction(
                  "saved-group",
                  "delete",
                  savedGroup,
                )}
                holdsLandingDestination={holdsRevisionDestination(
                  permissionsUtil,
                  "saved-group",
                  "publish",
                  panelRevision,
                  savedGroup,
                  NO_ENVIRONMENT_BINDING,
                )}
                canCommentOnEntity={canCommentOnRevisionEntity(
                  permissionsUtil,
                  "saved-group",
                  panelRevision,
                  savedGroup,
                )}
                canReviewEntity={canReviewRevisionEntity(
                  permissionsUtil,
                  "saved-group",
                  panelRevision,
                  savedGroup,
                  NO_ENVIRONMENT_BINDING,
                )}
                canManageDraftsEntity={canManageDrafts}
                canPublishEntity={canPublishRevisionEntity(
                  permissionsUtil,
                  "saved-group",
                  panelRevision,
                  savedGroup,
                  // Saved Groups are not partitioned by environment, so the check is
                  // deliberately unbound rather than scoped to an empty list.
                  NO_ENVIRONMENT_BINDING,
                )}
                // The basis the CANCEL arm actually uses: the adapter's
                // canPublishRevision(snapshot) = the entity's OWN scoped
                // environments, with no destination term and no archive-flip
                // widening. Dropping only the destination term left the widening,
                // so an env-limited publisher on an archive-flipping revision
                // still lost the Cancel button for a schedule the endpoint would
                // let them withdraw.
                canPublishEntityCoarse={permissionsUtil.canRevisionAction(
                  "saved-group",
                  "publish",
                  savedGroup,
                  NO_ENVIRONMENT_BINDING,
                )}
                canBypassApproval={!!canAdminPublish}
                selectRevision={selectFlow}
                onPublish={handlePublish}
                onDiscard={handleDiscard}
                onReopen={handleReopen}
                onRevert={(rev) => {
                  setRevisionToRevert(rev);
                  setConfirmRevert(true);
                }}
                publishBlockedReason={
                  // Archiving still works without Enterprise, for cleanup, so an
                  // archive-only draft can be published (the back end allows it)
                  remoteLocked &&
                  !isSavedGroupRevisionArchiveOnly(
                    panelRevision?.target.proposedChanges,
                  )
                    ? REMOTE_LOCKED_REASON
                    : undefined
                }
                revertBlockedReason={
                  remoteLocked ? REMOTE_LOCKED_REASON : undefined
                }
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
                {savedGroup.type === "list" &&
                  !isIdListSupportedAttribute(attr) && (
                    <Callout status="error" my="3">
                      The attribute for this Saved Group has an unsupported
                      datatype. It cannot be edited and it may produce
                      unexpected behavior when used in SDKs. Try using a{" "}
                      <Link href="/saved-groups#conditionGroups">
                        Condition Group
                      </Link>{" "}
                      instead
                    </Callout>
                  )}
                {upgradeModal && (
                  <UpgradeModal
                    close={() => setUpgradeModal(false)}
                    source="remote-saved-groups"
                    commercialFeature="large-saved-groups"
                  />
                )}
                {remoteLocked && (
                  <Callout status="warning" mb="4">
                    Changing Remote Groups needs an Enterprise plan. Feature
                    Flags and experiments that use this group keep working, and
                    you can still archive or unarchive it, but you can&apos;t
                    upload IDs, change its version, publish other drafts or roll
                    back.{" "}
                    <Link onClick={() => setUpgradeModal(true)}>Upgrade</Link>
                  </Callout>
                )}
                {savedGroup.type === "remote" ? (
                  <RemoteSavedGroupSetupCallout />
                ) : (
                  <LargeSavedGroupPerformanceWarning
                    {...largeSavedGroupSupport}
                    type={
                      savedGroup.type === "condition" ? "condition" : "list"
                    }
                  />
                )}
                {savedGroup.type === "remote" ? (
                  <RemoteSavedGroupUploads
                    savedGroup={savedGroup}
                    canUpload={permissionsUtil.canRevisionAction(
                      "saved-group",
                      "publish",
                      savedGroup,
                      NO_ENVIRONMENT_BINDING,
                    )}
                    planLockedReason={
                      remoteLocked ? REMOTE_LOCKED_REASON : null
                    }
                    viewing={isLive ? "live" : isDraft ? "draft" : "other"}
                    viewedVersion={displayedSavedGroup?.currentUploadVersion}
                    useVersionDisabledReason={
                      remoteLocked ? REMOTE_LOCKED_REASON : editBlockedReason
                    }
                    onUseVersion={(version) =>
                      setUseUploadModal({
                        version,
                        current: stateOf(editTarget),
                      })
                    }
                  />
                ) : savedGroup.type === "condition" ? (
                  <SectionFrame
                    title="Condition"
                    actions={
                      canEditView ? (
                        <Tooltip
                          content={editLockReason}
                          enabled={!!editLockReason}
                        >
                          <Button
                            variant="ghost"
                            disabled={!!editLockReason}
                            onClick={() =>
                              setEditConditionModal(stateOf(editTarget))
                            }
                          >
                            Edit
                          </Button>
                        </Tooltip>
                      ) : null
                    }
                  >
                    <Text as="div" weight="semibold" mb="3">
                      Include all users who match:
                    </Text>
                    <Flex direction="row" gap="2">
                      <Text weight="medium">IF</Text>
                      <Box flexGrow="1" minWidth="0">
                        <ConditionDisplay
                          condition={displayedSavedGroup?.condition || ""}
                          savedGroups={[]}
                        />
                      </Box>
                    </Flex>
                  </SectionFrame>
                ) : (
                  <SectionFrame
                    title="List Items"
                    titleAddon={
                      <>
                        <TabCount count={displayedValues.length} />
                        {canEditView && selected.size > 0 ? (
                          <Flex align="center" gap="4" ml="2">
                            <Text color="text-mid">
                              {selected.size} selected
                            </Text>
                            <Link onClick={() => setSelected(new Set())}>
                              Clear
                            </Link>
                            <Tooltip
                              content={editLockReason}
                              enabled={!!editLockReason}
                            >
                              <Button
                                variant="soft"
                                color="red"
                                disabled={!!editLockReason}
                                onClick={() => {
                                  setDeleteItemsDraftMode(
                                    editTarget ? "existing" : "new",
                                  );
                                  setDeleteItemsDraftSelectedId(
                                    editTarget?.id ?? null,
                                  );
                                  setLiveListPin(savedGroup.values ?? []);
                                  deleteConflict.clear({
                                    values: stateOf(editTarget).values ?? [],
                                  });
                                  setDeleteItemsModal(true);
                                }}
                              >
                                Remove
                              </Button>
                            </Tooltip>
                          </Flex>
                        ) : null}
                      </>
                    }
                    actions={
                      canEditView ? (
                        <Tooltip
                          content={editLockReason}
                          enabled={!!editLockReason}
                        >
                          <Flex gap="3" align="center">
                            <Button
                              variant="ghost"
                              color="red"
                              disabled={!!editLockReason}
                              onClick={() => openItemsModal("replace")}
                            >
                              Overwrite list
                            </Button>
                            <Button
                              variant="outline"
                              disabled={!!editLockReason}
                              icon={<PiPlus />}
                              onClick={() => openItemsModal("append")}
                            >
                              Add items
                            </Button>
                          </Flex>
                        </Tooltip>
                      ) : null
                    }
                  >
                    <Table variant="list" stickyHeader={false}>
                      <TableHeader>
                        <TableRow align="center">
                          {canEditView ? (
                            <TableColumnHeader style={{ width: 48 }}>
                              <Checkbox
                                value={
                                  filteredValues.length > 0 &&
                                  filteredValues.every((v) => selected.has(v))
                                }
                                setValue={(checked) =>
                                  setSelected(
                                    checked
                                      ? new Set(filteredValues)
                                      : new Set(),
                                  )
                                }
                                size="sm"
                                align="center"
                              />
                            </TableColumnHeader>
                          ) : null}
                          <TableColumnHeader
                            style={{ width: 72 }}
                            aria-sort={ariaSort(true, newestFirst ? -1 : 1)}
                          >
                            <SortButton
                              active
                              subtle
                              dir={newestFirst ? -1 : 1}
                              onClick={() => {
                                setNewestFirst(!newestFirst);
                                setCurrentPage(1);
                              }}
                            >
                              #
                            </SortButton>
                          </TableColumnHeader>
                          <TableColumnHeader>
                            <Flex justify="between" align="center" gap="3">
                              <span>{savedGroup.attributeKey}</span>
                              <Box style={{ width: 240 }}>
                                <Field
                                  size="sm"
                                  placeholder="Search..."
                                  aria-label="Search list items"
                                  type="search"
                                  value={filter}
                                  onChange={(e) => {
                                    setFilter(e.target.value);
                                    setCurrentPage(1);
                                  }}
                                />
                              </Box>
                            </Flex>
                          </TableColumnHeader>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {valuesPage.map((value) => (
                          <TableRow
                            key={value}
                            onClick={
                              canEditView
                                ? () => toggleSelected(value)
                                : undefined
                            }
                            style={
                              canEditView ? { cursor: "pointer" } : undefined
                            }
                          >
                            {canEditView ? (
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  value={selected.has(value)}
                                  setValue={() => toggleSelected(value)}
                                  size="sm"
                                  align="center"
                                />
                              </TableCell>
                            ) : null}
                            <TableCell>
                              <Text color="text-low">
                                {positions.get(value)}
                              </Text>
                            </TableCell>
                            <TableCell>{value}</TableCell>
                          </TableRow>
                        ))}
                        {!valuesPage.length && (
                          <TableRow>
                            <TableCell
                              colSpan={canEditView ? 3 : 2}
                              style={{ textAlign: "center" }}
                            >
                              {displayedValues.length
                                ? "No items match the current search."
                                : "This group doesn't have any items yet."}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                    {sortedValues.length > NUM_PER_PAGE && (
                      <Pagination
                        numItemsTotal={sortedValues.length}
                        currentPage={page}
                        perPage={NUM_PER_PAGE}
                        onPageChange={setCurrentPage}
                      />
                    )}
                    {!displayedValues.length &&
                      !displayedSavedGroup?.useEmptyListGroup && (
                        <Callout status="info">
                          This Saved Group has legacy behavior when empty and
                          will be completely ignored when used for targeting.{" "}
                          <DocLink useRadix={false} docSection="idLists">
                            Learn more
                          </DocLink>
                        </Callout>
                      )}
                  </SectionFrame>
                )}
              </>
            )}
          </Box>
        </div>
      </DetailsPanelLayout>
    </>
  );
}
