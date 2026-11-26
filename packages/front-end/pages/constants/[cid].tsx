import {
  NO_ENVIRONMENT_BINDING,
  canCommentOnRevisionEntity,
  canDeleteArchivedEntity,
  archiveFootprintForControl,
  canLandArchiveToggle,
  canLandRevertToTarget,
  canPublishRevisionEntity,
  canReviewRevisionEntity,
  holdsRevisionDestination,
  serveFootprint,
} from "shared/permissions";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { ConstantInterface } from "shared/types/constant";
import {
  Revision,
  applyTopLevelPatchOps,
  getConstantRestoreChange,
  getConstantRevisionChange,
  getLiveRevision,
  getRevisionNumberById,
  isRevisionEditLockedBySchedule,
} from "shared/enterprise";
import {
  proposedArchivedValue,
  constantRequiresReview,
  constantPublishEnvironments,
  getReviewSetting,
} from "shared/util";
import { isActiveDraftStatus } from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useEnvironments } from "@/services/features";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import ValueDisplay from "@/components/Features/ValueDisplay";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import ArchiveStateCallout from "@/components/Revision/ArchiveStateCallout";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import { SCHEDULE_EDIT_LOCK_REASON } from "@/components/Features/ScheduleLock";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import RevisionDropdown from "@/components/Revision/RevisionDropdown";
import ReviewAndPublishTab from "@/components/Revision/ReviewAndPublishTab";
import RevisionStatusBar, {
  hasRevisionStatus,
} from "@/components/Revision/RevisionStatusBar";
import { getStatusBadge } from "@/components/Revision/revisionUtils";
import RevisionLabel from "@/components/Reviews/RevisionLabel";
import NewDraftButton from "@/components/Reviews/NewDraftButton";
import { useRevisionStatusBarHeight } from "@/components/Reviews/RevisionStatusBarView";
import { TabsTrigger } from "@/ui/Tabs";
import SectionFrame from "@/components/SectionFrame";
import { DetailsPanelLayout, useDetailsPanel } from "@/components/DetailsPanel";
import {
  DetailsPageActions,
  DetailsPageMenu,
  DetailsPageTabs,
  DetailsPageTitleBar,
  REVISION_SELECTOR_WIDTH_PX,
  ReviewTabCount,
} from "@/components/Layout/DetailsPageHeader";
import { useTabsBottom } from "@/components/Layout/pageTopOffset";
import AuditHistoryExplorerModal from "@/components/AuditHistoryExplorer/AuditHistoryExplorerModal";
import { OVERFLOW_SECTION_LABEL } from "@/components/AuditHistoryExplorer/useAuditDiff";
import {
  REVISION_CONSTANT_DIFF_CONFIG,
  renderConstantSettings,
  renderConstantValues,
  getConstantSettingsBadges,
  getConstantValuesBadges,
} from "@/components/Constants/ConstantDiffRenders";
import { useConstantRevision } from "@/hooks/useConstantRevision";
import ConstantModal from "@/components/Constants/ConstantModal";
import ConstantValueModal from "@/components/Constants/ConstantValueModal";
import ConstantArchiveModal from "@/components/Constants/ConstantArchiveModal";
import { constantReferenceSections } from "@/components/Constants/ConstantReferencesList";
import CompareRevisionsModal from "@/components/Revision/CompareRevisionsModal";
import ConstantRevertModal from "@/components/Constants/ConstantRevertModal";
import ConstantDetailsPanel from "@/components/Constants/ConstantDetailsPanel";
import { useConstantReferences } from "@/hooks/useConstantReferences";
import { ConstantRevisionContext } from "@/components/Constants/useConstantDraftTarget";

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
      type={type === "string" ? "string" : "json"}
      full
      showFullscreenButton
      fullscreenHeader="Constant Value"
    />
  );
}

const constantTabs = ["overview", "review"] as const;
type ConstantTab = (typeof constantTabs)[number];

export default function ConstantDetailPage(): React.ReactElement {
  const router = useRouter();
  const { cid } = router.query;
  // The detail-page route is addressed by the constant's `key` (immutable,
  // org-unique). Sub-resource calls below use the resolved `constant.id`.
  const constantKey = typeof cid === "string" ? cid : "";

  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  const { organization, hasCommercialFeature, userId } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const environments = useEnvironments();

  const [editInfoOpen, setEditInfoOpen] = useState<
    false | "info" | "description"
  >(false);
  const [editValueOpen, setEditValueOpen] = useState(false);
  const [tab, setTab] = useState<ConstantTab>("overview");
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [revisionToRevert, setRevisionToRevert] = useState<Revision | null>(
    null,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The page instance is reused across constants, so close any modal carried
  // over from the previous constant.
  useEffect(() => {
    setEditInfoOpen(false);
    setEditValueOpen(false);
    setShowArchiveModal(false);
    setShowAuditModal(false);
    setCompareOpen(false);
    setConfirmRevert(false);
    setRevisionToRevert(null);
    setConfirmDelete(false);
    setMenuOpen(false);
  }, [constantKey]);

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
    selectionSettled,
    revisionsError,
  } = useConstantRevision(constant?.id, mutate, constant);

  // ── Page-level tabs: Overview | Review & Publish, driven by the URL hash.
  // The hash may carry a sub-tab after a comma (`#review,changes`); only the
  // first segment selects the page tab — the review tab reads the rest.
  useEffect(() => {
    const hash = (new URL(router.asPath, "http://x").hash
      .replace(/^#/, "")
      .split(",")[0] || undefined) as ConstantTab | undefined;
    if (hash && constantTabs.includes(hash)) {
      setTab(hash);
    }
  }, [router.asPath]);
  const setTabAndScroll = (newTab: ConstantTab) => {
    setTab(newTab);
    router.replace(
      { pathname: router.pathname, query: router.query, hash: newTab },
      undefined,
      { shallow: true },
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const details = useDetailsPanel({
    openKey: `constant-details-panel-open__${constantKey}`,
    widthKey: "constant-details-panel-width",
    tab,
    homeTab: "overview",
  });
  const tabsBottom = useTabsBottom();
  const [setStatusBarEl, statusBarHeight] = useRevisionStatusBarHeight();

  const liveRevision = useMemo(
    () => getLiveRevision(allRevisions) ?? null,
    [allRevisions],
  );
  const panelRevision = selectedRevision ?? liveRevision;

  // The environments the pending change actually touches. A base-value change
  // carries no footprint, but a per-environment override does — calling this
  // with no arguments always produced an empty list, so publish and revert
  // controls looked available to a caller restricted out of those environments.
  // Same computation the back end performs.
  const publishEnvironments = useMemo(() => {
    const pending = panelRevision;
    if (!pending) return constantPublishEnvironments();
    // Diffed against the LIVE constant, like the adapter — diffing against the
    // snapshot reported no changed environments whenever the proposed values merely
    // restate the snapshot while live has drifted, which SKIPS the env check for a
    // publish that really does overwrite those environments.
    const scoped = constantPublishEnvironments(
      getConstantRevisionChange(
        (constant ?? pending.target.snapshot) as ConstantInterface,
        pending.target.proposedChanges,
      ).changedEnvironments,
    );
    // Widened when the revision flips `archived` EITHER way, matching the
    // constant adapter — which ignores the change's own environments on a flip and
    // answers for everywhere the constant serves. `scoped` is deliberately NOT
    // passed through here: that is the CONFIG rule (a scoped Config keeps its own
    // environments), and borrowing it meant a revision that archived AND edited a
    // dev override demanded only dev on the client while the server demanded
    // everywhere.
    //
    // Judged against the LIVE constant, which is what the endpoint uses. Every
    // caller of `assertCanPublishRevision` passes a freshly-loaded live row — the
    // adapter's parameter is merely NAMED `snapshot` — so reading the revision's
    // snapshot here made this the only flag-family publish control on a basis the
    // server never uses, and it diverged in both directions.
    const proposedArchived = proposedArchivedValue(
      pending.target.proposedChanges,
    );
    const flipsArchived =
      proposedArchived !== undefined &&
      proposedArchived !== !!constant?.archived;
    return flipsArchived
      ? serveFootprint(environments, constant ?? {})
      : scoped;
  }, [panelRevision, constant, environments]);

  const {
    references,
    loading: referencesLoading,
    error: referencesError,
  } = useConstantReferences(constant?.id);

  const settings = organization.settings || {};
  const revertsBypassApproval = !!settings.revertsBypassApproval;
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
    !!selectedRevision && isActiveDraftStatus(selectedRevision.status);

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

  // A failed refresh keeps the revisions already shown.
  const loadError = error ?? (selectionSettled ? undefined : revisionsError);
  if (loadError) {
    return (
      <Callout status="error" mt="4">
        An error occurred: {loadError.message}
      </Callout>
    );
  }
  if (!constant || !displayedConstant || !selectionSettled) {
    return <LoadingOverlay />;
  }

  const canDraft = permissionsUtil.canRevisionAction(
    "constant",
    "draft",
    constant,
    NO_ENVIRONMENT_BINDING,
  );
  // Reverting is its own authority — a revert-only role holds no draft or
  // publish rights, and revert alone is enough to both propose and land one.
  const canRevertEntity = permissionsUtil.canRevisionAction(
    "constant",
    "revert",
    constant,
    NO_ENVIRONMENT_BINDING,
  );
  // Landing one answers for the environments the restore reaches.
  const canRevertLandingEntity = permissionsUtil.canRevisionAction(
    "constant",
    "revert",
    constant,
    publishEnvironments,
  );
  // Delete is gated on the LIVE archive state (not the displayed/draft state):
  // the constant must be archived and published before it can be deleted.
  // No environment footprint: an archived Constant serves nowhere, which is what
  // the server checks too. Using the pending revision's footprint here borrowed
  // an unrelated change's environments.
  const canDeleteNow = canDeleteArchivedEntity(
    permissionsUtil,
    "constant",
    constant,
  );
  // Editing is only meaningful on the live state or a draft (not when viewing a
  // merged/discarded revision). On live it starts a new draft; on a draft it
  // updates it.
  const canEditNow = canDraft && (!selectedRevision || isDraft);
  const editLockReason =
    selectedRevision &&
    isDraft &&
    isRevisionEditLockedBySchedule(selectedRevision)
      ? SCHEDULE_EDIT_LOCK_REASON
      : null;
  // Archiving is delete-class server-side — it takes the Constant out of service,
  // and being archived is what allows deleting it. Unarchiving returns it to
  // service, so it's an ordinary publish.
  // Either authority is enough: the landing atom stands on its own for a pure
  // archive, and an editor without it can still stage the flip as a draft.
  const canLandArchive = canLandArchiveToggle(
    permissionsUtil,
    "constant",
    constant,
    // The SERVE footprint, matching the archive endpoints. Raw org envs OVER-demand:
    // an environment scoped away from the constant's projects never serves it, so
    // requiring authority there hid Archive from a Deleter the endpoint allows.
    archiveFootprintForControl({ environments, entity: constant }),
  );
  const canArchiveNow =
    (canLandArchive || canEditNow) && (!selectedRevision || isDraft);

  // Whether the user can bypass approval for this constant (its project, or the
  // global "" project when unscoped) — enables the "publish now" option.
  const canBypassApproval = permissionsUtil.canBypassFlagApprovalChecks(
    {
      project: constant.project || "",
    },
    "constant",
  );

  const revisionCtx: ConstantRevisionContext = {
    allRevisions,
    openRevisions,
    selectedRevision,
    approvalRequired,
    metadataReviewRequired,
    canBypassApproval,
    canPublish: permissionsUtil.canRevisionAction(
      "constant",
      "publish",
      constant,
      publishEnvironments,
    ),
  };

  const revisionNumbers = getRevisionNumberById(allRevisions);
  const canPublishSelected = canPublishRevisionEntity(
    permissionsUtil,
    "constant",
    selectedRevision,
    constant,
    publishEnvironments,
  );

  const showsStatusBar =
    tab === "overview" &&
    hasRevisionStatus(selectedRevision, liveRevision, allRevisions);
  const stickyTop = tabsBottom + (showsStatusBar ? statusBarHeight : 0);

  const newDraft = canDraft ? (
    <NewDraftButton
      entityNoun="Constant"
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
          <>the live Constant</>
        )
      }
      create={async ({ title, comment }) => {
        // forceCreateRevision creates one regardless of approval settings.
        const res = await apiCall<{ revision?: Revision }>(
          `/constants/${constant.id}?forceCreateRevision=1`,
          { method: "PUT", body: JSON.stringify({}) },
        );
        const revision = res?.revision;
        if (!revision) return;
        if (title) {
          await apiCall(`/revision/${revision.id}/title`, {
            method: "PATCH",
            body: JSON.stringify({ title }),
          });
        }
        if (comment) {
          await apiCall(`/revision/${revision.id}/description`, {
            method: "PATCH",
            body: JSON.stringify({ description: comment }),
          });
        }
        await onRevisionCreated(revision);
      }}
    />
  ) : null;

  const menu = (
    <DetailsPageMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuGroup>
        <DropdownMenuItem
          onClick={() => {
            setMenuOpen(false);
            setShowAuditModal(true);
          }}
        >
          Audit history
        </DropdownMenuItem>
        {allRevisions.length >= 2 && (
          <DropdownMenuItem
            onClick={() => {
              setMenuOpen(false);
              setCompareOpen(true);
            }}
          >
            Compare revisions
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      {(canArchiveNow || canDeleteNow) && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {canArchiveNow && (
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  setShowArchiveModal(true);
                }}
              >
                {/* LIVE state: the endpoint flips against live, so the projected
                    state labels the opposite action. */}
                {constant.archived ? "Unarchive" : "Archive"}
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
    </DetailsPageMenu>
  );

  const environmentValues = Object.entries(
    displayedConstant.environmentValues || {},
  );

  return (
    <>
      <PageHead
        breadcrumb={[
          { display: "Constants", href: "/constants" },
          { display: displayedConstant.name },
        ]}
      />

      <DetailsPageTitleBar
        title={displayedConstant.name}
        onRename={canEditNow ? () => setEditInfoOpen("info") : null}
        renameBlockedReason={editLockReason}
        badges={
          constant.archived ? <Badge label="Archived" color="gray" /> : null
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
          noun="Constant"
          liveArchived={!!constant.archived}
          viewedArchived={!!displayedConstant.archived}
        />
      </DetailsPageTitleBar>

      <DetailsPageTabs
        value={tab}
        onValueChange={(v) => setTabAndScroll(v as ConstantTab)}
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
            entityId={constant.id}
            allRevisions={allRevisions}
            selectedRevisionId={selectedRevisionId}
            onSelectRevision={selectRevision}
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
              <RevisionStatusBar<ConstantInterface>
                selectedRevision={selectedRevision}
                liveRevision={liveRevision}
                allRevisions={allRevisions}
                liveSnapshot={constant}
                diffConfig={REVISION_CONSTANT_DIFF_CONFIG}
                entityNoun="Constant"
                requiresApproval={selectedRevisionRequiresApproval}
                canDiscard={canDraft || selectedRevision?.authorId === userId}
                onSelectRevision={selectRevision}
                onReviewPublish={() => setTabAndScroll("review")}
                onPublish={canPublishSelected ? handlePublish : null}
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
          <ConstantDetailsPanel
            constant={displayedConstant}
            onEditInfo={
              canEditNow ? (focus) => setEditInfoOpen(focus ?? "info") : null
            }
            editInfoBlockedReason={editLockReason}
            references={{
              rows: constantReferenceSections(references ?? {}),
              loading: referencesLoading,
              error: !!referencesError,
            }}
            revision={panelRevision}
            allRevisions={allRevisions}
            isLive={!selectedRevision}
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
            {tab === "overview" && (
              <SectionFrame
                title="Value"
                actions={
                  canEditNow ? (
                    <Tooltip
                      content={editLockReason}
                      enabled={!!editLockReason}
                    >
                      <Button
                        variant="ghost"
                        disabled={!!editLockReason}
                        onClick={() => setEditValueOpen(true)}
                      >
                        Edit
                      </Button>
                    </Tooltip>
                  ) : null
                }
              >
                <ConstantValueDisplay
                  value={displayedConstant.value}
                  type={displayedConstant.type}
                />
                {environmentValues.length > 0 && (
                  <>
                    <Text as="div" weight="semibold" mt="5" mb="3">
                      Environment overrides
                    </Text>
                    <Flex direction="column" gap="4">
                      {environmentValues.map(([env, value]) => (
                        <Box key={env}>
                          <Text
                            as="div"
                            size="sm"
                            weight="medium"
                            color="text-mid"
                            mb="1"
                          >
                            {env}
                          </Text>
                          <ConstantValueDisplay
                            value={value}
                            type={displayedConstant.type}
                          />
                        </Box>
                      ))}
                    </Flex>
                  </>
                )}
              </SectionFrame>
            )}

            {tab === "review" && (
              <ReviewAndPublishTab<ConstantInterface>
                revision={panelRevision}
                allRevisions={allRevisions}
                currentState={constant}
                diffConfig={REVISION_CONSTANT_DIFF_CONFIG}
                entityName={constant.name}
                entityNoun="Constant"
                requiresApproval={selectedRevisionRequiresApproval}
                reviewRules={reviewRule ? [reviewRule] : []}
                canEditEntity={permissionsUtil.canRevisionAction(
                  "constant",
                  "draft",
                  constant,
                  NO_ENVIRONMENT_BINDING,
                )}
                canRevertEntity={canRevertEntity}
                canLandRevertEntity={canRevertLandingEntity}
                canDeleteEntity={permissionsUtil.canRevisionAction(
                  "constant",
                  "delete",
                  constant,
                  NO_ENVIRONMENT_BINDING,
                )}
                // Landing an archive takes the constant out of service in every
                // environment, which is the footprint the publish endpoint demands.
                canLandArchiveEntity={canLandArchiveToggle(
                  permissionsUtil,
                  "constant",
                  constant,
                  // Narrowed to the constant's projects, like the server's
                  // `archiveServeFootprint` — raw org envs over-demanded.
                  archiveFootprintForControl({
                    environments,
                    entity: constant,
                  }),
                )}
                holdsLandingDestination={holdsRevisionDestination(
                  permissionsUtil,
                  "constant",
                  "publish",
                  panelRevision,
                  constant,
                  publishEnvironments,
                )}
                canCommentOnEntity={canCommentOnRevisionEntity(
                  permissionsUtil,
                  "constant",
                  panelRevision,
                  constant,
                )}
                canReviewEntity={canReviewRevisionEntity(
                  permissionsUtil,
                  "constant",
                  panelRevision,
                  constant,
                  publishEnvironments,
                )}
                canManageDraftsEntity={permissionsUtil.canRevisionAction(
                  "constant",
                  "draft",
                  constant,
                )}
                canPublishEntity={canPublishRevisionEntity(
                  permissionsUtil,
                  "constant",
                  panelRevision,
                  constant,
                  publishEnvironments,
                )}
                // The basis the CANCEL arm actually uses: the adapter's
                // `canPublishRevision(snapshot)` = the entity's OWN scoped
                // environments, with no destination term and no archive-flip
                // widening. Passing the revision-derived footprint dropped the
                // destination term but kept the widening, so an env-limited
                // publisher on an archive-flipping revision still lost the Cancel
                // button for a schedule the endpoint would let them withdraw.
                canPublishEntityCoarse={permissionsUtil.canRevisionAction(
                  "constant",
                  "publish",
                  constant,
                  constantPublishEnvironments(),
                )}
                canBypassApproval={canBypassApproval}
                selectRevision={selectRevision}
                onPublish={handlePublish}
                onDiscard={handleDiscard}
                onReopen={handleReopen}
                onRevert={(rev) => {
                  setRevisionToRevert(rev);
                  setConfirmRevert(true);
                }}
                onCompareRevisions={
                  allRevisions.length >= 2
                    ? () => setCompareOpen(true)
                    : undefined
                }
                mutate={async () => {
                  await Promise.all([mutateRevisions(), mutate()]);
                }}
              />
            )}
          </Box>
        </div>
      </DetailsPanelLayout>

      {editInfoOpen && (
        <ConstantModal
          existing={displayedConstant}
          focusDescription={editInfoOpen === "description"}
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
          // LIVE state, like the feature page does: the endpoint flips against
          // live, so handing the revision-PROJECTED Constant here inverted the
          // action whenever the viewed draft staged the opposite archive state —
          // the modal predicted one atom and submitted the other, and the endpoint
          // saw no transition at all and wrote nothing.
          constant={constant}
          revisionCtx={revisionCtx}
          onSaved={onRevisionCreated}
          selectFlow={selectRevision}
          close={() => setShowArchiveModal(false)}
        />
      )}

      {confirmRevert && revisionToRevert && (
        <ConstantRevertModal
          canRevert={canRevertEntity}
          canLandRevert={canRevertLandingEntity}
          // Recomputed per target: the picker can change it after mount, and both
          // the footprint and the destination follow from restoring THAT snapshot
          // over current live — the same derivation the revert endpoint uses.
          canLandRevertForTarget={(t) => {
            const restore = getConstantRestoreChange(constant, t.target);
            // A revert that flips `archived` takes the Constant out of service, or
            // returns it, EVERYWHERE it serves — the footprint the endpoint now
            // requires. The changed-environment list is empty for a base-value-only
            // restore, so predicting with it offered "Publish now" for an archive
            // restore the server then refused.
            // The COMPLETE state being restored — snapshot plus its patches — not
            // just this revision's `/archived` patch. A snapshot already archived
            // without the revision touching `/archived` restores an archived Constant
            // with no patch to read. Same derivation RevertModal uses.
            const restoredState = applyTopLevelPatchOps(
              t.target.snapshot as Record<string, unknown>,
              t.target.proposedChanges,
            ) as { archived?: boolean };
            const flipsArchive =
              !!restoredState.archived !== !!constant?.archived;
            return canLandRevertToTarget(
              permissionsUtil,
              "constant",
              constant,
              { project: restore.restoredProject },
              // `unresolvedOps` for the same reason the endpoint widens on it: a
              // restoration carrying an op this applier can't read names fewer
              // environments than the revert writes.
              flipsArchive || restore.unresolvedOps
                ? archiveFootprintForControl({
                    environments,
                    entity: constant ?? {},
                  })
                : constantPublishEnvironments(restore.changedEnvironments),
            );
          }}
          canLandArchive={canLandArchive}
          canDraft={canDraft}
          constant={constant}
          revision={revisionToRevert}
          allRevisions={allRevisions}
          diffConfig={REVISION_CONSTANT_DIFF_CONFIG}
          revertsBypassApproval={revertsBypassApproval}
          approvalRequired={approvalRequired}
          canBypassApproval={canBypassApproval}
          close={() => {
            setConfirmRevert(false);
            setRevisionToRevert(null);
          }}
          onRevisionCreated={async (rev) => {
            await onRevisionCreated(rev);
            // A revert may publish immediately; refresh the global cache too.
            await mutateDefinitions();
            setConfirmRevert(false);
            setRevisionToRevert(null);
          }}
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

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${constant.name}"?`}
          content="This permanently deletes the Constant. This cannot be undone."
          yesText="Delete"
          color="red"
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
