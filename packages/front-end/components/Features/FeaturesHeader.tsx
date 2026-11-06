import {
  NO_ENVIRONMENT_BINDING,
  canStageArchiveDraft,
} from "shared/permissions";
import { useRouter } from "next/router";
import React, { ReactNode, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { filterEnvironmentsByFeature, isDefined } from "shared/util";
import { PiEye } from "react-icons/pi";
import {
  isActiveDraftStatus,
  REVIEW_REQUESTED_STATUSES,
  HoldoutInterface,
} from "shared/validators";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import Heading from "@/ui/Heading";
import Badge from "@/ui/Badge";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
// eslint-disable-next-line no-restricted-imports -- legacy Modal still backs the watchers modal; migrate to @/ui/Modal in a follow-up
import Modal from "@/components/Modal";
import Callout from "@/ui/Callout";
import FeatureStatusBadge from "@/components/Features/FeatureStatusBadge";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useWatching } from "@/services/WatchProvider";
import CompareFeatureEventsModal from "@/components/Features/CompareFeatureEventsModal";
import FeatureImplementationModal from "@/components/Features/FeatureImplementationModal";
import FeatureModal from "@/components/Features/FeatureModal";
import StaleDetectionModal from "@/components/Features/StaleDetectionModal";
import { FeatureTab } from "@/pages/features/[fid]";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import NewDraftButton from "@/components/Features/NewDraftButton";
import { useHoldouts } from "@/hooks/useHoldouts";
import {
  DetailsPanelToggle,
  PANEL_WIDTH_PX,
} from "@/components/CollapsiblePanelLayout";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownSubMenu,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import { useFeatureHealthStates } from "@/hooks/useFeatureHealthStates";
import usePinnedHeader from "@/hooks/usePinnedHeader";
import { draftStatusTooltip } from "@/components/Reviews/RevisionStatusBadge";
import FeatureArchiveModal from "./FeatureArchiveModal";
import FeatureDeleteModal from "./FeatureDeleteModal";
import AddToHoldoutModal from "./AddToHoldoutModal";

// The details panel's default width, less the page gutter (24px) and the
// menu button and its gap beside the CTA (34px).
const REVISION_SELECTOR_WIDTH_PX = PANEL_WIDTH_PX - 58;

export default function FeaturesHeader({
  feature,
  baseFeature,
  mutate,
  setVersion,
  version,
  revisions,
  tab,
  setTab,
  holdout,
  isReadOnly = false,
  onCompareRevisions,
  detailsOpen,
  setDetailsOpen,
  statusBar,
}: {
  feature: FeatureInterface;
  // Live feature doc. `feature` is merged with whichever revision is being
  // viewed, so anything describing the flag's actual service state has to read
  // this instead.
  baseFeature: FeatureInterface;
  mutate: () => Promise<unknown>;
  setVersion: (version: number) => void;
  version: number | null;
  revisions: MinimalFeatureRevisionInterface[];
  tab: FeatureTab;
  setTab: (tab: FeatureTab) => void;
  holdout: HoldoutInterface | undefined;
  isReadOnly?: boolean;
  onCompareRevisions?: () => void;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  // The viewed revision's state, fixed under the tabs.
  statusBar?: ReactNode;
}) {
  const router = useRouter();
  const firstFeature = router?.query && "first" in router.query;
  const [auditModal, setAuditModal] = useState(false);
  const [watchersModal, setWatchersModal] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState(false);
  const [staleFFModal, setStaleFFModal] = useState(false);
  const [addToHoldoutModal, setAddToHoldoutModal] = useState(false);
  const [archiveModal, setArchiveModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [staleStatusOpen, setStaleStatusOpen] = useState(false);
  const [showImplementation, setShowImplementation] = useState(firstFeature);
  const { hasCommercialFeature, users } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);

  const { apiCall } = useAuth();
  const { watchedFeatures, refreshWatching } = useWatching();
  const isWatching = watchedFeatures.includes(feature.id);
  const { data: watchersData } = useApi<{ userIds: string[] }>(
    `/feature/${feature.id}/watchers`,
  );
  const usersWatching = (watchersData?.userIds || [])
    .map((id) => users.get(id))
    .filter(isDefined)
    .map((u) => u.name || u.email);
  async function handleWatchUpdates(watch: boolean) {
    await apiCall(
      `/user/${watch ? "watch" : "unwatch"}/feature/${feature.id}`,
      {
        method: "POST",
      },
    );
    refreshWatching();
    setDropdownOpen(false);
  }
  const { holdouts } = useHoldouts(feature.project);
  const holdoutsEnabled = hasCommercialFeature("holdouts");

  const healthHook = useFeatureHealthStates();
  const staleData = healthHook.getHealthState(feature.id);

  // Initial fetch when navigating to a feature (uses cache if fresh).
  useEffect(() => {
    healthHook.fetchSome([feature.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature.id]);
  const watchHealth = healthHook.watch;
  useEffect(() => watchHealth([feature.id]), [feature.id, watchHealth]);

  const [tabsPinSentinelRef, headerPinned] = usePinnedHeader();

  // Re-compute whenever the feature is saved (version increments on publish).
  const prevVersionRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      prevVersionRef.current !== null &&
      prevVersionRef.current !== feature.version
    ) {
      healthHook.invalidate([feature.id]);
      healthHook.fetchSome([feature.id]);
    }
    prevVersionRef.current = feature.version ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature.id, feature.version]);

  const handleRerunStale = async () => {
    healthHook.invalidate([feature.id]);
    await healthHook.fetchSome([feature.id]);
  };

  // Editing an existing flag takes draft authority, not the create gate:
  // `canViewFeatureModal` answers "may this user create a feature".
  const canEdit = permissionsUtil.canEditFeatureDrafts(feature);
  const enabledEnvs = getEnabledEnvironments(feature, environments);
  const canPublish = permissionsUtil.canPublishFeature(feature, enabledEnvs);
  // Duplicating CREATES a flag, so it takes create authority — not authority over
  // the one being copied. The modal gates its own environment toggles.
  const canDuplicate = permissionsUtil.canCreateFeature(
    { project: feature.project },
    NO_ENVIRONMENT_BINDING,
  );
  // Archive controls use live state, not the viewed draft projection.
  const isArchived = baseFeature.archived;
  const liveArchiveEnvs = getEnabledEnvironments(
    baseFeature,
    filterEnvironmentsByFeature(allEnvironments, baseFeature),
  );
  const canArchive = permissionsUtil.canDeleteFeature(
    baseFeature,
    liveArchiveEnvs,
  );
  const canDelete = permissionsUtil.canDeleteFeature(
    baseFeature,
    NO_ENVIRONMENT_BINDING,
  );
  const canUnarchive = permissionsUtil.canPublishFeature(
    baseFeature,
    liveArchiveEnvs,
  );
  const canToggleArchive =
    (isArchived ? canUnarchive : canArchive) ||
    canStageArchiveDraft({
      permissions: permissionsUtil,
      model: "feature",
      entity: { project: baseFeature.project },
      archived: !isArchived,
    });

  // Tab chip + tooltip count revisions at "request review" or beyond; drafts
  // still being edited don't need reviewer/publisher attention.
  const draftStatusCounts: Partial<Record<string, number>> = {};
  revisions.forEach((r) => {
    if ((REVIEW_REQUESTED_STATUSES as readonly string[]).includes(r.status)) {
      draftStatusCounts[r.status] = (draftStatusCounts[r.status] ?? 0) + 1;
    }
  });
  const activeDraftCount = Object.values(draftStatusCounts).reduce<number>(
    (sum, n) => sum + (n ?? 0),
    0,
  );

  const viewedRevision = revisions.find(
    (r) => r.version === (version ?? feature.version),
  );
  const viewingDraft =
    !!viewedRevision && isActiveDraftStatus(viewedRevision.status);
  // Judged on the live flag, like the server.
  const canEditDrafts = permissionsUtil.canEditFeatureDrafts(baseFeature);

  const headerActions = (
    <Flex align="center" gap="4" height="var(--space-6)">
      {/* A draft's way to review is on the status bar under the tabs. */}
      {viewingDraft ? null : canEditDrafts ? (
        <NewDraftButton
          feature={baseFeature}
          revisionList={revisions}
          mutate={mutate}
          setVersion={setVersion}
        />
      ) : null}
      <DropdownMenu
        trigger={<MoreMenuTrigger label="More actions" size="lg" />}
        open={dropdownOpen}
        onOpenChange={setDropdownOpen}
        menuPlacement="end"
      >
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              setShowImplementation(true);
              setDropdownOpen(false);
            }}
          >
            Show implementation
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setAuditModal(true);
              setDropdownOpen(false);
            }}
          >
            Audit history
          </DropdownMenuItem>
          {onCompareRevisions && (
            <DropdownMenuItem
              onClick={() => {
                onCompareRevisions();
                setDropdownOpen(false);
              }}
            >
              Compare revisions
            </DropdownMenuItem>
          )}
          <DropdownSubMenu
            trigger={
              <Flex
                align="center"
                className={isWatching ? "font-weight-bold" : ""}
              >
                <PiEye style={{ marginRight: "5px" }} size={18} />
                <span className="pr-5">
                  {isWatching ? "Watching" : "Not watching"}
                </span>
              </Flex>
            }
          >
            <DropdownMenuItem
              onClick={async () => {
                await handleWatchUpdates(!isWatching);
              }}
            >
              {isWatching ? "Stop watching" : "Start watching"}
            </DropdownMenuItem>
          </DropdownSubMenu>
          <DropdownMenuItem
            onClick={() => {
              setWatchersModal(true);
              setDropdownOpen(false);
            }}
            disabled={!usersWatching.length}
          >
            <Flex as="div" align="center">
              <IconButton
                style={{
                  marginRight: "5px",
                  backgroundColor:
                    usersWatching.length > 0
                      ? "var(--violet-9)"
                      : "var(--slate-9)",
                }}
                radius="full"
                size="1"
              >
                {usersWatching.length || 0}
              </IconButton>
              {usersWatching.length > 0 ? "View watchers" : "No watchers"}
            </Flex>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {canEdit &&
          canPublish &&
          holdoutsEnabled &&
          holdouts.length > 0 &&
          !holdout?.id &&
          !isReadOnly && (
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  setAddToHoldoutModal(true);
                  setDropdownOpen(false);
                }}
              >
                Add to holdout
              </DropdownMenuItem>
            </DropdownMenuGroup>
          )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              setStaleStatusOpen(true);
              setDropdownOpen(false);
            }}
          >
            Check stale status
          </DropdownMenuItem>
          {canEdit && canPublish && !isReadOnly && (
            <DropdownMenuItem
              onClick={() => {
                setStaleFFModal(true);
                setDropdownOpen(false);
              }}
            >
              {feature.neverStale
                ? "Enable stale detection"
                : "Disable stale detection"}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        {/* `canDuplicate` belongs in this predicate, not only on its own item: a
            create-only user holds none of the other three, so the whole group was
            hidden and Duplicate never rendered even though its own check passed. */}
        {(canDuplicate ||
          (canEdit && canPublish) ||
          canToggleArchive ||
          (isArchived && canDelete)) &&
          !isReadOnly && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {canDuplicate && (
                  <DropdownMenuItem
                    onClick={() => {
                      setDuplicateModal(true);
                      setDropdownOpen(false);
                    }}
                  >
                    Duplicate
                  </DropdownMenuItem>
                )}
                {canToggleArchive && (
                  <DropdownMenuItem
                    onClick={() => {
                      setArchiveModal(true);
                      setDropdownOpen(false);
                    }}
                  >
                    {isArchived ? "Unarchive" : "Archive"}
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              {isArchived && canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      color="red"
                      onClick={() => {
                        setDeleteModal(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}
            </>
          )}
      </DropdownMenu>
    </Flex>
  );

  // White over the page's violet, which only the content column below shows.
  return (
    <>
      {/* Padding inline: container-fluid's own outranks Radix's props. */}
      <Box
        className="container-fluid pagecontents"
        position="relative"
        style={{
          background: "var(--color-panel-solid)",
          padding: "var(--space-4) var(--space-5) var(--space-2)",
        }}
      >
        <Box>
          <Flex direction="row" align="start" justify="between" gap="5">
            {/* Raised so the name's x-height centres on the buttons' text. */}
            <Flex align="center" gap="3" mt="-3px">
              <Heading
                as="h1"
                size="2xl"
                color="text-high"
                overflowWrap="anywhere"
                weight="medium"
                mb="0"
              >
                {feature.id}
              </Heading>
              <FeatureStatusBadge
                // Live doc: the chip states actual status, not the draft's.
                feature={baseFeature}
                staleData={staleData}
                fetchStaleData={handleRerunStale}
                onDisable={canEdit ? () => setStaleFFModal(true) : undefined}
                open={staleStatusOpen}
                onOpenChange={setStaleStatusOpen}
              />
            </Flex>
            {headerActions}
          </Flex>
          {isArchived ? (
            <Callout status="info" mt="3">
              <strong>This Feature Flag is archived.</strong> It will not be
              included in SDK Endpoints or Webhook payloads.
            </Callout>
          ) : feature.archived ? (
            <Callout status="warning" mt="3">
              <strong>This draft will archive the Feature Flag.</strong> Once
              published it will be removed from SDK Endpoints and Webhook
              payloads.
            </Callout>
          ) : null}
        </Box>
      </Box>
      <>
        <div
          ref={tabsPinSentinelRef}
          aria-hidden
          className="d-print-none"
          style={{
            height: 1,
            width: "100%",
            pointerEvents: "none",
            background: "var(--color-panel-solid)",
          }}
        />
        <div
          className={clsx("feature-tabs d-print-none", {
            pinned: headerPinned,
          })}
        >
          <Box
            className="container-fluid pagecontents"
            position="relative"
            style={{ paddingInline: "var(--space-5)" }}
          >
            <Flex align="center" className="header-tabs">
              <Tabs
                value={tab}
                onValueChange={setTab}
                style={{ flex: 1, minWidth: 0 }}
              >
                <TabsList size="lg" style={{ width: "100%" }}>
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
                  <TabsTrigger value="test">Simulate</TabsTrigger>
                  <TabsTrigger value="stats">Code Refs</TabsTrigger>
                  <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
                  {/* Hooks are self-hosted only and boolean flags have no schema, so Cloud booleans have nothing to validate */}
                  {!(isCloud() && feature.valueType === "boolean") && (
                    <TabsTrigger value="validation">Validation</TabsTrigger>
                  )}
                </TabsList>
              </Tabs>
              {/* Beside the tab list, not in it: the list folds tabs that
                  don't fit into its More menu. Runs from the details panel's
                  default edge to the CTA's right edge above it, which sits
                  2px right of where the toggle's margin ends the row. */}
              <Box flexShrink="0" ml="4" mr="-2px">
                <RevisionDropdown
                  feature={feature}
                  revisions={revisions}
                  version={version ?? feature.version}
                  setVersion={setVersion}
                  context="header"
                  width={REVISION_SELECTOR_WIDTH_PX}
                />
              </Box>
              <DetailsPanelToggle open={detailsOpen} setOpen={setDetailsOpen} />
            </Flex>
          </Box>
          {statusBar}
        </div>
      </>
      {auditModal && (
        <CompareFeatureEventsModal
          feature={feature}
          onClose={() => setAuditModal(false)}
        />
      )}
      {watchersModal && (
        <Modal
          trackingEventModalType=""
          open={true}
          header="Feature Watchers"
          close={() => setWatchersModal(false)}
          closeCta="Close"
        >
          <ul>
            {usersWatching.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </Modal>
      )}
      {duplicateModal && (
        <FeatureModal
          cta={"Duplicate"}
          close={() => setDuplicateModal(false)}
          onSuccess={async (feature) => {
            const url = `/features/${feature.id}?new`;
            await router.push(url);
          }}
          featureToDuplicate={feature}
        />
      )}
      {staleFFModal && (
        <StaleDetectionModal
          close={() => setStaleFFModal(false)}
          feature={feature}
          revisionList={revisions}
          mutate={mutate}
          setVersion={setVersion}
          onEnable={handleRerunStale}
        />
      )}
      {showImplementation && (
        <FeatureImplementationModal
          feature={feature}
          first={firstFeature}
          close={() => {
            setShowImplementation(false);
          }}
        />
      )}
      {addToHoldoutModal && (
        <AddToHoldoutModal
          close={() => setAddToHoldoutModal(false)}
          feature={feature}
          revisionList={revisions}
          mutate={mutate}
          setVersion={setVersion}
        />
      )}
      {archiveModal && (
        <FeatureArchiveModal
          // LIVE state, like the menu label above: the endpoint flips against
          // live, and handing the revision-projected feature here inverted the
          // action whenever the viewed draft staged the opposite archive state.
          feature={baseFeature}
          close={() => setArchiveModal(false)}
          revisionList={revisions}
          mutate={mutate}
          setVersion={setVersion}
        />
      )}
      {deleteModal && (
        <FeatureDeleteModal
          feature={feature}
          close={() => setDeleteModal(false)}
          onDelete={async () => {
            await apiCall(`/feature/${feature.id}`, {
              method: "DELETE",
            });
            await router.push("/features");
          }}
        />
      )}
    </>
  );
}
