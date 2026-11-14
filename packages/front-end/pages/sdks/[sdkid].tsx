import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { WebhookInterface } from "shared/types/webhook";
import {
  getConnectionSDKCapabilities,
  getSDKCapabilityVersion,
} from "shared/sdk-versioning";
import {
  isActiveDraftStatus,
  parseSdkWebhookSnapshot,
  SDKConnectionRevisionSnapshot,
  SDKConnectionSettingsRevisionSnapshot,
} from "shared/validators";
import { useRouter } from "next/router";
import { holdsSdkConnectionDraftDestination } from "shared/permissions";
import React, { useEffect, useMemo, useState } from "react";
import { Box } from "@radix-ui/themes";
import {
  Revision,
  applyTopLevelPatchOps,
  getLiveRevision,
  getRevisionNumberById,
  getSdkConnectionGoverningRules,
  getSdkConnectionReviewRules,
  isScheduledPublishLockActive,
  sdkConnectionSettingsAfter,
} from "shared/enterprise";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAuth } from "@/services/auth";
import CreateSDKConnectionModal from "@/components/Features/SDKConnections/CreateSDKConnectionModal";
import SDKConnectionArchiveModal from "@/components/Features/SDKConnections/SDKConnectionArchiveModal";
import CompareRevisionsModal from "@/components/Revision/CompareRevisionsModal";
import SDKConnectionRevertModal from "@/components/Features/SDKConnections/SDKConnectionRevertModal";
import useSDKConnections from "@/hooks/useSDKConnections";
import useApi from "@/hooks/useApi";
import { useSDKConnectionRevision } from "@/hooks/useSDKConnectionRevision";
import PageHead from "@/components/Layout/PageHead";
import SdkWebhooks from "@/components/Features/SDKConnections/SdkWebhooks";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import SDKConnectionOverview from "@/components/Features/SDKConnections/SDKConnectionOverview";
import SDKConnectionDetailsPanel from "@/components/Features/SDKConnections/SDKConnectionDetailsPanel";
import SDKConnectionEditsBar from "@/components/Features/SDKConnections/SDKConnectionEditsBar";
import { useSdkConnectionStagedEdits } from "@/components/Features/SDKConnections/useSdkConnectionStagedEdits";
import Tooltip from "@/ui/Tooltip";
import SDKConnectionEditModal from "@/components/Features/SDKConnections/SDKConnectionEditModal";
import { withAbsentSettings } from "@/components/Features/SDKConnections/sdkConnectionRules";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import { TabsTrigger } from "@/ui/Tabs";
import RevisionDropdown from "@/components/Revision/RevisionDropdown";
import RevisionStatusBar, {
  hasRevisionStatus,
} from "@/components/Revision/RevisionStatusBar";
import ReviewAndPublishTab from "@/components/Revision/ReviewAndPublishTab";
import { getStatusBadge } from "@/components/Revision/revisionUtils";
import RevisionLabel from "@/components/Reviews/RevisionLabel";
import NewDraftButton from "@/components/Reviews/NewDraftButton";
import { useRevisionStatusBarHeight } from "@/components/Reviews/RevisionStatusBarView";
import { EDITS_BLOCKED_REASON } from "@/components/StagedEdits/StagedEditsBar";
import { SCHEDULE_EDIT_LOCK_REASON } from "@/components/Features/ScheduleLock";
import { REVISION_SDK_CONNECTION_DIFF_CONFIG } from "@/components/Features/SDKConnections/SDKConnectionDiffRenders";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { docUrl } from "@/components/DocLink";
import { languageMapping } from "@/components/Features/SDKConnections/SDKLanguageLogo";
import { PayloadSizeCallout } from "@/components/Features/SDKConnections/PayloadSizeNotices";
import { capitalizeFirstLetter } from "@/services/utils";
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
import {
  TABS_BAR_HEIGHT_PX,
  TABS_HEADER_HEIGHT_PX,
} from "@/components/Layout/constants";

const SDK_CONNECTION_TABS = ["overview", "webhooks", "review"] as const;
type SDKConnectionTab = (typeof SDK_CONNECTION_TABS)[number];

// Webhooks are required: an empty list reads as "every webhook was added" and
// flags a false conflict.
function flattenConnection(
  connection: SDKConnectionInterface,
  webhooks: WebhookInterface[] = [],
): SDKConnectionRevisionSnapshot {
  const settings: SDKConnectionSettingsRevisionSnapshot = {
    id: connection.id,
    organization: connection.organization,
    name: connection.name,
    ...(connection.eventTracker !== undefined && {
      eventTracker: connection.eventTracker,
    }),
    languages: connection.languages,
    ...(connection.sdkVersion !== undefined && {
      sdkVersion: connection.sdkVersion,
    }),
    environment: connection.environment,
    projects: connection.projects ?? [],
    encryptPayload: connection.encryptPayload,
    ...(connection.hashSecureAttributes !== undefined && {
      hashSecureAttributes: connection.hashSecureAttributes,
    }),
    ...(connection.includeVisualExperiments !== undefined && {
      includeVisualExperiments: connection.includeVisualExperiments,
    }),
    ...(connection.includeDraftExperiments !== undefined && {
      includeDraftExperiments: connection.includeDraftExperiments,
    }),
    ...(connection.includeDraftExperimentRefs !== undefined && {
      includeDraftExperimentRefs: connection.includeDraftExperimentRefs,
    }),
    ...(connection.includeExperimentNames !== undefined && {
      includeExperimentNames: connection.includeExperimentNames,
    }),
    ...(connection.includeRedirectExperiments !== undefined && {
      includeRedirectExperiments: connection.includeRedirectExperiments,
    }),
    ...(connection.includeRuleIds !== undefined && {
      includeRuleIds: connection.includeRuleIds,
    }),
    ...(connection.includeProjectIdInMetadata !== undefined && {
      includeProjectIdInMetadata: connection.includeProjectIdInMetadata,
    }),
    ...(connection.includeCustomFieldsInMetadata !== undefined && {
      includeCustomFieldsInMetadata: connection.includeCustomFieldsInMetadata,
    }),
    ...(connection.allowedCustomFieldsInMetadata !== undefined && {
      allowedCustomFieldsInMetadata: connection.allowedCustomFieldsInMetadata,
    }),
    ...(connection.includeTagsInMetadata !== undefined && {
      includeTagsInMetadata: connection.includeTagsInMetadata,
    }),
    ...(connection.includeExperimentScheduleInMetadata !== undefined && {
      includeExperimentScheduleInMetadata:
        connection.includeExperimentScheduleInMetadata,
    }),
    ...(connection.remoteEvalEnabled !== undefined && {
      remoteEvalEnabled: connection.remoteEvalEnabled,
    }),
    ...(connection.tracesEnabled !== undefined && {
      tracesEnabled: connection.tracesEnabled,
    }),
    ...(connection.savedGroupReferencesEnabled !== undefined && {
      savedGroupReferencesEnabled: connection.savedGroupReferencesEnabled,
    }),
    ...(connection.savedGroupFormat !== undefined && {
      savedGroupFormat: connection.savedGroupFormat,
    }),
    ...(connection.includeReferencedPrerequisites !== undefined && {
      includeReferencedPrerequisites: connection.includeReferencedPrerequisites,
    }),
    // Omitted when unset: an explicit `undefined` isn't isEqual to an absent
    // key, which would show as a phantom diff.
    ...(connection.proxy?.enabled !== undefined && {
      proxyEnabled: connection.proxy.enabled,
    }),
    ...(connection.proxy?.host !== undefined && {
      proxyHost: connection.proxy.host,
    }),
    ...(connection.archived !== undefined && { archived: connection.archived }),
  };
  return {
    sdkConnection: settings,
    sdkWebhooks: webhooks.map((wh) =>
      parseSdkWebhookSnapshot({ ...wh, httpMethod: wh.httpMethod ?? "POST" }),
    ),
  };
}

function overlayFlattenedOnConnection(
  connection: SDKConnectionInterface,
  flattened: Record<string, unknown>,
): SDKConnectionInterface {
  const next: SDKConnectionInterface = { ...connection };
  const proxy = { ...connection.proxy };
  let proxyTouched = false;
  for (const [key, value] of Object.entries(flattened)) {
    if (key === "proxyEnabled") {
      proxy.enabled = value as boolean;
      proxyTouched = true;
    } else if (key === "proxyHost") {
      proxy.host = value as string;
      proxyTouched = true;
    } else {
      (next as unknown as Record<string, unknown>)[key] = value;
    }
  }
  if (proxyTouched) next.proxy = proxy;
  return next;
}

// Overlaid on live so fields excluded from the snapshot (key, encryptionKey,
// connected, managedBy, proxy signing key) are preserved.
function buildDisplayedConnection(
  connection: SDKConnectionInterface,
  revision: Revision | null,
): SDKConnectionInterface {
  if (!revision) return connection;
  // A draft shows what it holds: its own changes over where it started.
  const effective = applyTopLevelPatchOps(
    revision.target.snapshot as Record<string, unknown>,
    revision.target.proposedChanges,
  ) as SDKConnectionRevisionSnapshot;
  const settings = (effective.sdkConnection ?? {}) as Record<string, unknown>;
  // A setting history left out was off then, whatever live says now. A draft
  // keeps live's, as publishing it would.
  return overlayFlattenedOnConnection(
    connection,
    isActiveDraftStatus(revision.status)
      ? settings
      : withAbsentSettings(settings),
  );
}

export default function SDKConnectionPage() {
  const router = useRouter();
  const { sdkid } = router.query;

  const { data, mutate, error } = useSDKConnections({
    includeArchived: true,
  });
  const { data: webhookData, mutate: mutateWebhooks } = useApi<{
    webhooks?: WebhookInterface[];
  }>(`/sdk-connections/${sdkid}/webhooks`, { shouldRun: () => !!sdkid });

  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { userId } = useUser();
  const settings = useOrgSettings();

  const [duplicateSource, setDuplicateSource] =
    useState<SDKConnectionInterface | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [revisionToRevert, setRevisionToRevert] = useState<Revision | null>(
    null,
  );
  const [renaming, setRenaming] = useState(false);

  const [tab, setTab] = useState<SDKConnectionTab>("overview");
  const setTabAndScroll = (next: SDKConnectionTab) => {
    setTab(next);
    void router.push(
      { pathname: router.pathname, query: router.query, hash: next },
      undefined,
      { shallow: true },
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  useEffect(() => {
    const hash = new URL(router.asPath, "http://x").hash.slice(1).split(",")[0];
    const next = SDK_CONNECTION_TABS.find((t) => t === hash);
    if (next) setTab(next);
  }, [router.asPath]);

  // Open state is remembered per connection; width is a global preference.
  const details = useDetailsPanel({
    openKey: `sdk-connection-details-panel-open__${sdkid}`,
    widthKey: "sdk-connection-details-panel-width",
    tab,
    homeTab: ["overview", "webhooks"],
  });

  const [setStatusBarEl, statusBarHeight] = useRevisionStatusBarHeight();

  const connection: SDKConnectionInterface | undefined =
    data?.connections?.find((conn) => conn.id === sdkid);

  const liveRules = connection
    ? getSdkConnectionGoverningRules(settings.approvalFlows, {
        projects: connection.projects,
        environment: connection.environment,
      })
    : [];
  const approvalRequired = liveRules.length > 0;
  const metadataReviewRequired = liveRules.some(
    (r) => r.requireMetadataReview !== false,
  );

  // Publishing lands webhook changes too, so revalidate webhooks with it.
  const mutateLive = () => {
    mutate();
    mutateWebhooks();
  };

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
  } = useSDKConnectionRevision(connection?.id, mutateLive, connection);
  const refreshAll = async () => {
    await Promise.all([mutateRevisions(), mutate()]);
  };

  const hasRevisions = allRevisions.length > 0;
  const liveRevision = getLiveRevision(allRevisions) ?? null;

  // Same rules the server checks: the live and destination scopes, minus
  // exemptions.
  const selectedRevisionReviewRules = useMemo(
    () =>
      selectedRevision
        ? getSdkConnectionReviewRules(
            settings.approvalFlows,
            selectedRevision.target.snapshot as SDKConnectionRevisionSnapshot,
            selectedRevision.target.proposedChanges,
          )
        : [],
    [selectedRevision, settings.approvalFlows],
  );
  const selectedRevisionRequiresApproval =
    selectedRevisionReviewRules.length > 0;

  const canBypassLive =
    !!connection &&
    permissionsUtil.canBypassSDKConnectionApprovalChecks({
      projects: connection.projects,
    });
  const canAdminPublish = approvalRequired && canBypassLive;
  const canAutoPublish = !approvalRequired || canAdminPublish;

  // Bypass for the selected draft needs authority in both the live projects
  // and the ones the draft moves the connection into.
  const canBypassSelectedRevision =
    !selectedRevisionRequiresApproval ||
    (canBypassLive &&
      permissionsUtil.canBypassSDKConnectionApprovalChecks({
        projects: selectedRevision
          ? (sdkConnectionSettingsAfter(
              selectedRevision.target.snapshot as SDKConnectionRevisionSnapshot,
              selectedRevision.target.proposedChanges,
            ).projects ?? [])
          : [],
      }));

  const displayedConnection = useMemo(() => {
    if (!connection) return undefined;
    return buildDisplayedConnection(connection, selectedRevision);
  }, [connection, selectedRevision]);

  const staged = useSdkConnectionStagedEdits(
    displayedConnection,
    selectedRevisionId,
  );

  const liveSnapshot = useMemo(
    () =>
      connection
        ? flattenConnection(connection, webhookData?.webhooks ?? [])
        : undefined,
    [connection, webhookData],
  );

  if (error) {
    return (
      <Box className="contents container-fluid pagecontents" pt="4">
        <Callout status="error">{error.message}</Callout>
      </Box>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }
  if (!connection || !liveSnapshot || !staged) {
    return (
      <Box className="contents container-fluid pagecontents" pt="4">
        <Callout status="error">Invalid SDK Connection id</Callout>
      </Box>
    );
  }

  const canDuplicate = permissionsUtil.canCreateSDKConnection(connection);
  const canUpdate = permissionsUtil.canUpdateSDKConnection(connection, {});
  // Publishing or approving a draft that moves the connection also takes
  // update rights where it lands, as the server checks.
  const holdsDestinationOf = (revision: Revision | null) =>
    holdsSdkConnectionDraftDestination(permissionsUtil, connection, revision);
  const canDelete =
    permissionsUtil.canDeleteSDKConnection(connection) &&
    !connection.managedBy?.type;
  const isExternallyManaged = !!connection.managedBy?.type;

  const displayedConn = displayedConnection ?? connection;
  const viewingDraft =
    !!selectedRevision && isActiveDraftStatus(selectedRevision.status);
  // Edits land on an open draft, or on a new one cut from live; any other
  // revision (discarded or superseded) is history.
  const isReadOnly = !!selectedRevision && !viewingDraft;
  const editBlockedReason =
    viewingDraft &&
    isScheduledPublishLockActive(selectedRevision) &&
    selectedRevision.scheduledPublishLockEdits
      ? SCHEDULE_EDIT_LOCK_REASON
      : null;
  // Edits staged on a revision that has since been discarded or superseded
  // have nowhere to be saved or discarded from, so they hold nothing.
  const hasUnsavedEdits = staged.dirty && !isReadOnly;
  const stagedBlockedReason = hasUnsavedEdits ? EDITS_BLOCKED_REASON : null;

  const supportsBucketingV2 =
    getConnectionSDKCapabilities(displayedConn).includes("bucketingV2");
  const bucketingV2IntroducedVersion = getSDKCapabilityVersion(
    displayedConn.languages?.[0],
    "bucketingV2",
  );
  const sdkDocSection = displayedConn.languages?.[0]
    ? languageMapping[displayedConn.languages[0]]?.docs
    : undefined;

  const revisionNumbers = getRevisionNumberById(allRevisions);
  const panelRevision = selectedRevision ?? liveRevision;
  const holdsSelectedDestination = holdsDestinationOf(selectedRevision);
  const holdsPanelDestination = holdsDestinationOf(panelRevision);

  const showsStatusBar =
    tab === "overview" &&
    hasRevisionStatus(selectedRevision, liveRevision, allRevisions);
  const stickyTop =
    TABS_HEADER_HEIGHT_PX +
    TABS_BAR_HEIGHT_PX +
    (showsStatusBar ? statusBarHeight : 0);

  const revisionProps = {
    onRevisionCreated,
    openRevisions,
    allRevisions,
    selectedRevision,
    onSelectRevision: selectFlow,
    approvalRequired,
    canAutoPublish,
    metadataReviewRequired,
  };

  const newDraft = canUpdate ? (
    <NewDraftButton
      entityNoun="SDK Connection"
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
          <>the live SDK Connection</>
        )
      }
      create={async ({ title, comment }) => {
        const res = await apiCall<{ revision?: Revision }>(
          `/sdk-connections/${connection.id}?forceCreateRevision=1`,
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
        await refreshAll();
        selectFlow(revision);
      }}
    />
  ) : null;

  const menu =
    canUpdate || canDuplicate || canDelete || allRevisions.length >= 2 ? (
      <DetailsPageMenu
        open={dropdownOpen}
        onOpenChange={setDropdownOpen}
        disabledReason={stagedBlockedReason}
      >
        {allRevisions.length >= 2 && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  setShowCompareModal(true);
                  setDropdownOpen(false);
                }}
              >
                Compare revisions
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          {canDuplicate && (
            <DropdownMenuItem
              onClick={() => {
                setDuplicateSource(connection);
                setDropdownOpen(false);
              }}
            >
              Duplicate
            </DropdownMenuItem>
          )}
          {canUpdate && !isExternallyManaged && (
            <DropdownMenuItem
              onClick={() => {
                setDropdownOpen(false);
                setShowArchiveModal(true);
              }}
            >
              {connection.archived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        {/* Under an approval rule, live must be archived before deleting. */}
        {canDelete && (connection.archived || !approvalRequired) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                color="red"
                confirmation={{
                  confirmationTitle: "Delete SDK Connection",
                  cta: "Delete",
                  getConfirmationContent: async () =>
                    "Are you sure? This will permanently delete the SDK connection and any associated session recordings will no longer be accessible.",
                  submit: async () => {
                    await apiCall(`/sdk-connections/${connection.id}`, {
                      method: "DELETE",
                    });
                    mutate();
                    router.push(`/sdks`);
                  },
                  closeDropdown: () => setDropdownOpen(false),
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DetailsPageMenu>
    ) : null;

  return (
    <>
      {duplicateSource && (
        <CreateSDKConnectionModal
          close={() => setDuplicateSource(null)}
          mutate={mutate}
          initialValue={duplicateSource}
        />
      )}

      {showArchiveModal && (
        <SDKConnectionArchiveModal
          connection={connection}
          close={() => setShowArchiveModal(false)}
          openRevisions={openRevisions}
          allRevisions={allRevisions}
          mutate={refreshAll}
          onRevisionCreated={onRevisionCreated}
          selectFlow={selectFlow}
        />
      )}

      {revisionToRevert && (
        <SDKConnectionRevertModal
          liveSnapshot={{ ...liveSnapshot, id: connection.id }}
          revision={revisionToRevert}
          allRevisions={allRevisions}
          diffConfig={REVISION_SDK_CONNECTION_DIFF_CONFIG}
          approvalRequired={approvalRequired}
          canBypassApproval={canAdminPublish}
          canRevert={canUpdate}
          close={() => setRevisionToRevert(null)}
          onRevisionCreated={(rev) => {
            onRevisionCreated(rev);
            setRevisionToRevert(null);
            // Published straight away, it changes what live reads.
            if (rev.status === "merged") mutateLive();
          }}
        />
      )}

      {showCompareModal && (
        <CompareRevisionsModal<SDKConnectionRevisionSnapshot>
          liveEntity={liveSnapshot}
          entityId={connection.id}
          diffConfig={REVISION_SDK_CONNECTION_DIFF_CONFIG}
          currentRevisionId={selectedRevisionId}
          allRevisions={allRevisions}
          onClose={() => setShowCompareModal(false)}
          requiresApproval={approvalRequired}
        />
      )}

      {renaming && (
        <SDKConnectionEditModal
          connection={displayedConn}
          mutate={mutate}
          close={() => setRenaming(false)}
          {...revisionProps}
        />
      )}

      <PageHead
        breadcrumb={[
          { display: "SDK Connections", href: "/sdks" },
          { display: displayedConn.name },
        ]}
      />

      <DetailsPageTitleBar
        title={displayedConn.name}
        onRename={canUpdate && !isReadOnly ? () => setRenaming(true) : null}
        renameBlockedReason={stagedBlockedReason ?? editBlockedReason}
        badges={
          <>
            {/* Set the first time anything fetches with the key; never reset. */}
            {connection.connected ? (
              <Tooltip content="An SDK or proxy has fetched features with this connection's key at least once.">
                {/* Focusable, so the explanation opens from the keyboard too. */}
                <Box as="span" display="inline-block" tabIndex={0}>
                  <Badge
                    color="green"
                    variant="soft"
                    radius="full"
                    label="Connected"
                  />
                </Box>
              </Tooltip>
            ) : (
              <>
                <Tooltip content="Nothing has fetched features with this connection's key yet.">
                  <Box as="span" display="inline-block" tabIndex={0}>
                    <Badge
                      color="gray"
                      variant="soft"
                      radius="full"
                      label="Not connected"
                    />
                  </Box>
                </Tooltip>
                {canUpdate && <Link onClick={() => mutate()}>Retry</Link>}
              </>
            )}
            {connection.managedBy?.type ? (
              <Badge
                label={`Managed by ${capitalizeFirstLetter(
                  connection.managedBy.type,
                )}`}
              />
            ) : null}
          </>
        }
        actions={
          <DetailsPageActions
            // A draft's way to review is on the status bar under the tabs,
            // and staged edits have their own way to a draft.
            newDraft={viewingDraft || hasUnsavedEdits ? null : newDraft}
            menu={menu}
          />
        }
      >
        {connection.archived ? (
          <Callout status="info" mt="3">
            <strong>This SDK Connection is archived.</strong> It serves no
            payload.
          </Callout>
        ) : displayedConn.archived ? (
          <Callout status="warning" mt="3">
            <strong>This draft will archive the SDK Connection.</strong> Once
            published it will serve no payload.
          </Callout>
        ) : null}
        <PayloadSizeCallout connection={connection} mt="3" mb="0" />
        {!supportsBucketingV2 && (
          <Callout status="warning" mt="3">
            <Text weight="semibold">
              Upgrade to {bucketingV2IntroducedVersion}+ for V2 hashing.
            </Text>{" "}
            Until then, new experiments in this connection&apos;s projects fall
            back to V1.{" "}
            <Link
              href={docUrl(sdkDocSection ?? "sdks")}
              target="_blank"
              rel="noopener noreferrer"
            >
              View docs
            </Link>
          </Callout>
        )}
      </DetailsPageTitleBar>

      <DetailsPageTabs
        value={tab}
        onValueChange={setTabAndScroll}
        triggers={
          <>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="webhooks">
              Webhooks
              <TabCount count={webhookData?.webhooks?.length ?? 0} />
            </TabsTrigger>
            <TabsTrigger value="review">
              Review &amp; Publish
              <ReviewTabCount statuses={allRevisions.map((r) => r.status)} />
            </TabsTrigger>
          </>
        }
        revisionPicker={
          hasRevisions ? (
            // Held while edits are staged, which belong to the viewed revision.
            <Tooltip content={EDITS_BLOCKED_REASON} enabled={hasUnsavedEdits}>
              <div>
                <RevisionDropdown
                  entityId={connection.id}
                  allRevisions={allRevisions}
                  selectedRevisionId={selectedRevisionId}
                  onSelectRevision={selectFlow}
                  requiresApproval={approvalRequired}
                  context="header"
                  width={REVISION_SELECTOR_WIDTH_PX}
                  disabled={hasUnsavedEdits}
                />
              </div>
            </Tooltip>
          ) : null
        }
        detailsOpen={details.open}
        setDetailsOpen={details.toggle}
        statusBar={
          showsStatusBar ? (
            <div ref={setStatusBarEl}>
              <RevisionStatusBar<SDKConnectionRevisionSnapshot>
                selectedRevision={selectedRevision}
                liveRevision={liveRevision}
                allRevisions={allRevisions}
                liveSnapshot={liveSnapshot}
                diffConfig={REVISION_SDK_CONNECTION_DIFF_CONFIG}
                entityNoun="SDK Connection"
                requiresApproval={selectedRevisionRequiresApproval}
                canDiscard={canUpdate || selectedRevision?.authorId === userId}
                onSelectRevision={selectFlow}
                onReviewPublish={() => setTabAndScroll("review")}
                onPublish={
                  canUpdate && holdsSelectedDestination ? handlePublish : null
                }
                onDiscard={handleDiscard}
                blockedReason={stagedBlockedReason}
              />
            </div>
          ) : null
        }
      />

      <DetailsPanelLayout
        details={details}
        stickyTop={stickyTop}
        footer={
          hasUnsavedEdits && canUpdate ? (
            <SDKConnectionEditsBar
              connection={displayedConn}
              staged={staged}
              draft={viewingDraft ? selectedRevision : null}
              openRevisions={openRevisions}
              allRevisions={allRevisions}
              onRevisionCreated={onRevisionCreated}
              onSelectRevision={selectFlow}
              mutate={refreshAll}
            />
          ) : null
        }
        panel={
          <SDKConnectionDetailsPanel
            connection={displayedConn}
            webhookCount={webhookData?.webhooks?.length ?? 0}
            onEditWebhooks={
              canUpdate ? () => setTabAndScroll("webhooks") : null
            }
            editWebhooksBlockedReason={stagedBlockedReason}
            revision={panelRevision}
            allRevisions={allRevisions}
            isLive={!selectedRevision}
            requiresApproval={approvalRequired}
            canEditRevision={canUpdate}
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
            tab={details.panelTab}
            setTab={details.setPanelTab}
          />
        }
      >
        <div className="details-column">
          <Box className="contents container-fluid pagecontents">
            {tab === "overview" && (
              <SDKConnectionOverview
                // Starts over from what's saved when the viewed revision changes.
                key={selectedRevisionId ?? "live"}
                connection={displayedConn}
                staged={staged}
                canEdit={canUpdate && !isReadOnly}
                blockedReason={editBlockedReason}
                connections={data.connections.map((c) =>
                  c.id === displayedConn.id ? displayedConn : c,
                )}
                mutate={refreshAll}
                viewingLive={
                  !selectedRevision || selectedRevision.id === liveRevision?.id
                }
                onRevisionCreated={onRevisionCreated}
              />
            )}
            {tab === "review" && (
              <ReviewAndPublishTab<SDKConnectionRevisionSnapshot>
                revision={panelRevision}
                allRevisions={allRevisions}
                currentState={liveSnapshot}
                diffConfig={REVISION_SDK_CONNECTION_DIFF_CONFIG}
                entityName={displayedConn.name}
                entityNoun="SDK Connection"
                requiresApproval={selectedRevisionRequiresApproval}
                reviewRules={selectedRevisionReviewRules}
                canEditEntity={canUpdate}
                canReviewEntity={canUpdate && holdsPanelDestination}
                holdsLandingDestination={holdsPanelDestination}
                canBypassApproval={canBypassSelectedRevision}
                selectRevision={selectFlow}
                publishBlockedReason={stagedBlockedReason ?? undefined}
                reviewBlockedReason={stagedBlockedReason ?? undefined}
                onPublish={handlePublish}
                onDiscard={async (id) => {
                  if (hasUnsavedEdits) throw new Error(EDITS_BLOCKED_REASON);
                  await handleDiscard(id);
                }}
                onReopen={handleReopen}
                onRevert={setRevisionToRevert}
                onCompareRevisions={() => setShowCompareModal(true)}
                mutate={async () => {
                  await Promise.all([
                    mutateRevisions(),
                    mutate(),
                    mutateWebhooks(),
                  ]);
                }}
              />
            )}
            {tab === "webhooks" && (
              <SdkWebhooks
                connection={connection}
                liveRevisionId={liveRevision?.id ?? null}
                refresh={refreshAll}
                {...revisionProps}
              />
            )}
          </Box>
        </div>
      </DetailsPanelLayout>
    </>
  );
}
