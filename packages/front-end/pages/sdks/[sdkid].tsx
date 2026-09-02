import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { WebhookInterface } from "shared/types/webhook";
import {
  getConnectionSDKCapabilities,
  getSDKCapabilityVersion,
} from "shared/sdk-versioning";
import {
  SDKConnectionRevisionSnapshot,
  SDKConnectionSettingsRevisionSnapshot,
} from "shared/validators";
import { useRouter } from "next/router";
import React, { useMemo, useState } from "react";
import { PiDotsThreeVertical } from "react-icons/pi";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  Revision,
  applyTopLevelPatchOps,
  getSdkConnectionApprovalRule,
  isSdkConnectionRevisionMetadataOnly,
} from "shared/enterprise";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAuth } from "@/services/auth";
import CreateSDKConnectionModal from "@/components/Features/SDKConnections/CreateSDKConnectionModal";
import SDKConnectionArchiveModal from "@/components/Features/SDKConnections/SDKConnectionArchiveModal";
import CompareRevisionsModal from "@/components/Revision/CompareRevisionsModal";
import CodeSnippetModal from "@/components/Features/CodeSnippetModal";
import useSDKConnections from "@/hooks/useSDKConnections";
import useApi from "@/hooks/useApi";
import { useSDKConnectionRevision } from "@/hooks/useSDKConnectionRevision";
import PageHead from "@/components/Layout/PageHead";
import SdkWebhooks from "@/components/Features/SDKConnections/SdkWebhooks";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import SDKConnectionSettingsCards from "@/components/Features/SDKConnections/SDKConnectionSettingsCards";
import SDKConnectionHeaderMeta from "@/components/Features/SDKConnections/SDKConnectionHeaderMeta";
import SDKConnectionCredentialsCard from "@/components/Features/SDKConnections/SDKConnectionCredentialsCard";
import EditSDKOverviewModal from "@/components/Features/SDKConnections/edit-modals/EditSDKOverviewModal";
import EditSDKSettingsModal, {
  SDKConnectionEditSection,
} from "@/components/Features/SDKConnections/edit-modals/EditSDKSettingsModal";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import { RevisionDiffConfig } from "@/components/Revision/useRevisionDiff";
import ConfirmDialog from "@/ui/ConfirmDialog";
import RevisionDropdown from "@/components/Revision/RevisionDropdown";
import RevisionSummaryCard from "@/components/Revision/RevisionSummaryCard";
import ReviewAndPublishTab from "@/components/Revision/ReviewAndPublishTab";
import { REVISION_SDK_CONNECTION_DIFF_CONFIG } from "@/components/Features/SDKConnections/SDKConnectionDiffRenders";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { docUrl } from "@/components/DocLink";
import { languageMapping } from "@/components/Features/SDKConnections/SDKLanguageLogo";
import { capitalizeFirstLetter } from "@/services/utils";

// Build the revision snapshot for a live connection. The webhooks are passed in
// because the live snapshot is the merge target for conflict detection: an empty
// array here reads as "every webhook was added" and flags a false conflict.
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
    ...(connection.savedGroupReferencesEnabled !== undefined && {
      savedGroupReferencesEnabled: connection.savedGroupReferencesEnabled,
    }),
    // Emitted only when set: an explicit `undefined` is not equal to an absent
    // key under lodash isEqual, which would show as a permanent phantom diff
    // against a snapshot that simply omitted them.
    ...(connection.proxy?.enabled !== undefined && {
      proxyEnabled: connection.proxy.enabled,
    }),
    ...(connection.proxy?.host !== undefined && {
      proxyHost: connection.proxy.host,
    }),
    ...(connection.archived !== undefined && { archived: connection.archived }),
  };
  // Mirrors the adapter's toWebhookSnapshot: runtime/secret fields are omitted
  // so the two sides of a diff line up.
  return {
    sdkConnection: settings,
    sdkWebhooks: webhooks.map((wh) => ({
      id: wh.id,
      name: wh.name,
      endpoint: wh.endpoint,
      httpMethod: wh.httpMethod ?? "POST",
      ...(wh.headers !== undefined && { headers: wh.headers }),
      ...(wh.payloadFormat !== undefined && {
        payloadFormat: wh.payloadFormat,
      }),
      ...(wh.payloadKey !== undefined && { payloadKey: wh.payloadKey }),
      ...(wh.disabled !== undefined && { disabled: wh.disabled }),
    })) as SDKConnectionRevisionSnapshot["sdkWebhooks"],
  };
}

// Overlay a flattened snapshot-shaped object onto a live connection. Flattened
// proxy keys (proxyEnabled/proxyHost) are mapped back onto the nested `proxy`
// object that SDKConnectionInterface uses.
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

// Build the connection shape that represents the revision's effective state
// (snapshot + proposed changes), overlaid on the live connection so secret /
// system fields excluded from the snapshot (key, encryptionKey, connected,
// managedBy, proxy signing key) are preserved.
function buildDisplayedConnection(
  connection: SDKConnectionInterface,
  revision: Revision | null,
): SDKConnectionInterface {
  if (!revision) return connection;
  const effective = applyTopLevelPatchOps(
    revision.target.snapshot as Record<string, unknown>,
    revision.target.proposedChanges,
  ) as SDKConnectionRevisionSnapshot;
  return overlayFlattenedOnConnection(
    connection,
    (effective.sdkConnection ?? {}) as Record<string, unknown>,
  );
}

export default function SDKConnectionPage() {
  const router = useRouter();
  const { sdkid } = router.query;

  const { data, mutate, error } = useSDKConnections();
  // The live webhooks are part of the revision snapshot, so the page needs them
  // to build an accurate merge target for diffing and conflict detection.
  const { data: webhookData } = useApi<{ webhooks?: WebhookInterface[] }>(
    `/sdk-connections/${sdkid}/webhooks`,
    { shouldRun: () => !!sdkid },
  );

  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { user, hasCommercialFeature } = useUser();
  const settings = useOrgSettings();

  // Duplicate opens the create modal seeded from this connection.
  const [duplicateSource, setDuplicateSource] =
    useState<SDKConnectionInterface | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [confirmNewDraft, setConfirmNewDraft] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [editSection, setEditSection] = useState<
    SDKConnectionEditSection | "overview" | null
  >(null);

  const connection: SDKConnectionInterface | undefined =
    data?.connections?.find((conn) => conn.id === sdkid);

  const hasApprovalsFeature = hasCommercialFeature("require-approvals");

  // Per-connection approval is scoped by project + environment via the shared
  // helper (no client re-implementation of scoping). Only drives button
  // enable/disable; the backend re-validates on the 200/202 response.
  const matchedRule =
    hasApprovalsFeature && connection
      ? getSdkConnectionApprovalRule(settings.approvalFlows, {
          projects: connection.projects,
          environment: connection.environment,
        })
      : undefined;
  const approvalRequired = !!matchedRule;
  const metadataReviewRequired = matchedRule?.requireMetadataReview ?? true;

  const revisionState = useSDKConnectionRevision(
    connection?.id,
    mutate,
    connection,
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
  } = revisionState;

  const hasRevisions = allRevisions.length > 0;

  // Per-revision approval gate: a metadata-only revision (name only) can be
  // published without review when `requireMetadataReview` is off. Mirrors the
  // server-side rule in the sdk-connection adapter.
  const selectedRevisionRequiresApproval =
    !!selectedRevision &&
    approvalRequired &&
    (metadataReviewRequired ||
      // The baseline is required: without it the helper conservatively
      // returns false, which made this constantly `approvalRequired` and left
      // `requireMetadataReview: false` with no observable effect in the UI
      // even though the server honoured it.
      !isSdkConnectionRevisionMetadataOnly(
        selectedRevision.target.proposedChanges,
        selectedRevision.target.snapshot as Record<string, unknown>,
      ));

  const canAdminPublish =
    approvalRequired &&
    !!connection &&
    (user?.role === "admin" ||
      (connection.projects.length
        ? connection.projects.every((p) =>
            permissionsUtil.canBypassSDKConnectionApprovalChecks({
              project: p || "",
            }),
          )
        : permissionsUtil.canBypassSDKConnectionApprovalChecks({
            project: "",
          })));
  const canAutoPublish = !approvalRequired || canAdminPublish;

  const displayRevision = useMemo(() => {
    if (selectedRevision) return selectedRevision;
    return [...allRevisions]
      .filter((r) => r.status === "merged")
      .sort(
        (a, b) =>
          new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
      )[0];
  }, [selectedRevision, allRevisions]);

  // The connection shape representing the selected revision's effective state
  // (snapshot + proposed changes), overlaid on the live connection so secret
  // fields stay intact. Falls back to the live connection when nothing is
  // selected. Used to drive the page's visual representation.
  const displayedConnection = useMemo(() => {
    if (!connection) return undefined;
    return buildDisplayedConnection(connection, selectedRevision ?? null);
  }, [connection, selectedRevision]);

  const liveSnapshot = useMemo(
    () =>
      connection
        ? flattenConnection(connection, webhookData?.webhooks ?? [])
        : undefined,
    [connection, webhookData],
  );

  const saveRevisionTitle = async (title: string) => {
    if (!selectedRevision) return;
    await apiCall(`/revision/${selectedRevision.id}/title`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    await mutateRevisions();
  };

  if (error) {
    return (
      <div className="contents container pagecontents">
        <Callout status="error">{error.message}</Callout>
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }
  if (!connection) {
    return (
      <div className="contents container pagecontents">
        <Callout status="error">Invalid SDK Connection id</Callout>
      </div>
    );
  }

  const canDuplicate = permissionsUtil.canCreateSDKConnection(connection);
  const canUpdate = permissionsUtil.canUpdateSDKConnection(connection, {});
  // Delete is gated on the LIVE archived state — the backend enforces the same
  // rule (archive must be published before delete is allowed).
  const canDelete =
    permissionsUtil.canDeleteSDKConnection(connection) &&
    !connection.managedBy?.type;
  const isExternallyManaged = !!connection.managedBy?.type;

  const displayedConn = displayedConnection ?? connection;
  const displayedName = displayedConn.name;
  const displayedArchived = !!displayedConn.archived;

  // V2 hashing requires a recent SDK version; warn when this connection's SDK
  // predates it, same as the connections list does.
  const supportsBucketingV2 =
    getConnectionSDKCapabilities(displayedConn).includes("bucketingV2");
  const bucketingV2IntroducedVersion = getSDKCapabilityVersion(
    displayedConn.languages?.[0],
    "bucketingV2",
  );
  const sdkDocSection = displayedConn.languages?.[0]
    ? languageMapping[displayedConn.languages[0]]?.docs
    : undefined;

  // Whether to surface revision/approval UI. Without the feature, edits just
  // auto-publish and the page behaves as before (minus archive-then-delete).
  const showRevisionUI = hasApprovalsFeature && hasRevisions;

  // Per-section edit modal routing. Each section opens its dedicated modal.
  const openEditSection = (section: SDKConnectionEditSection | "overview") => {
    setEditSection(section);
  };
  const closeEditSection = () => setEditSection(null);

  return (
    <div className="contents container pagecontents">
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
          mutate={async () => {
            await Promise.all([mutateRevisions(), mutate()]);
          }}
          onRevisionCreated={onRevisionCreated}
          selectFlow={selectFlow}
        />
      )}

      {showCompareModal && (
        <CompareRevisionsModal
          liveEntity={liveSnapshot as Record<string, unknown>}
          entityId={connection.id}
          diffConfig={
            REVISION_SDK_CONNECTION_DIFF_CONFIG as unknown as RevisionDiffConfig<
              Record<string, unknown>
            >
          }
          currentRevisionId={selectedRevisionId}
          allRevisions={allRevisions}
          onClose={() => setShowCompareModal(false)}
          requiresApproval={approvalRequired}
        />
      )}

      {confirmNewDraft && (
        <ConfirmDialog
          title="Create New Draft"
          content="Create a new draft to make changes to this SDK connection. The live version stays unchanged until the draft is published."
          yesText="Create Draft"
          onCancel={() => setConfirmNewDraft(false)}
          onConfirm={async () => {
            const res = await apiCall<{
              status: number;
              requiresApproval?: boolean;
              revision?: Revision;
            }>(`/sdk-connections/${connection.id}?forceCreateRevision=1`, {
              method: "PUT",
              body: JSON.stringify({}),
            });
            if (res?.revision) {
              await Promise.all([mutateRevisions(), mutate()]);
              selectFlow(res.revision);
            }
            setConfirmNewDraft(false);
          }}
        />
      )}

      <PageHead
        breadcrumb={[
          { display: "SDK Connections", href: "/sdks" },
          { display: displayedName },
        ]}
      />

      {connection.managedBy?.type ? (
        <div className="mb-2">
          <Badge
            label={`Managed by ${capitalizeFirstLetter(
              connection.managedBy.type,
            )}`}
          />
        </div>
      ) : null}

      <Flex align="start" justify="between" gap="2" mb="2">
        <Flex align="center" gap="3" style={{ marginTop: "-4px" }}>
          <Heading size="xl" as="h1" mb="0">
            {displayedName}
          </Heading>
          {connection.connected ? (
            <Badge color="green" variant="solid" label="Connected" />
          ) : (
            <Badge color="gray" variant="soft" label="Not connected" />
          )}
          {displayedArchived && <Badge label="Archived" color="gray" />}
        </Flex>
        <Flex align="center" gap="4" pr="2">
          {showRevisionUI && (
            <RevisionDropdown
              entityId={connection.id}
              allRevisions={allRevisions}
              selectedRevisionId={selectedRevisionId}
              onSelectRevision={selectFlow}
              requiresApproval={approvalRequired}
              context="header"
            />
          )}
          {(canUpdate ||
            canDuplicate ||
            canDelete ||
            (canUpdate && !isExternallyManaged)) && (
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="2"
                  highContrast
                >
                  <PiDotsThreeVertical size={16} />
                </IconButton>
              }
              menuPlacement="end"
              open={dropdownOpen}
              onOpenChange={setDropdownOpen}
            >
              {canUpdate && (
                <DropdownMenuItem
                  onClick={() => {
                    // The revision-aware modal, not SDKConnectionForm: that
                    // form PUTs with no revision params, so under approvals it
                    // returned 202 without writing while the UI reported
                    // success and minted an orphan draft per save.
                    openEditSection("overview");
                    setDropdownOpen(false);
                  }}
                >
                  Edit
                </DropdownMenuItem>
              )}
              {canDuplicate && (
                <>
                  {canUpdate && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onClick={() => {
                      setDuplicateSource(connection);
                      setDropdownOpen(false);
                    }}
                  >
                    Duplicate
                  </DropdownMenuItem>
                </>
              )}
              {canUpdate && !isExternallyManaged && (
                <>
                  {(canDuplicate || canUpdate) && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onClick={() => {
                      setDropdownOpen(false);
                      setShowArchiveModal(true);
                    }}
                  >
                    {connection.archived ? "Unarchive" : "Archive"}
                  </DropdownMenuItem>
                </>
              )}
              {/* Delete is only enabled once the LIVE connection is archived —
                  the backend enforces the same rule. */}
              {canDelete && connection.archived && (
                <DropdownMenuItem
                  color="red"
                  confirmation={{
                    confirmationTitle: "Delete SDK Connection",
                    cta: "Delete",
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
              )}
            </DropdownMenu>
          )}
        </Flex>
      </Flex>

      <SDKConnectionHeaderMeta
        connection={displayedConn}
        canUpdate={canUpdate}
        onEditProjects={() => openEditSection("overview")}
      />

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

      <Tabs value={activeTab} onValueChange={setActiveTab} mt="4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="implementation">Implementation</TabsTrigger>
          {showRevisionUI && (
            <TabsTrigger value="review">Review &amp; Publish</TabsTrigger>
          )}
        </TabsList>
        {/* The Review & Publish tab renders its own revision header, so the
            summary card (and its draft banner) would duplicate it there. */}
        {showRevisionUI && activeTab !== "review" && (
          <Box mt="4">
            <RevisionSummaryCard
              allRevisions={allRevisions}
              selectedRevision={selectedRevision}
              entityNoun="SDK Connection"
              hasRevisions={allRevisions.length > 0}
              canEditTitle={canUpdate}
              canEditDescription={canUpdate}
              // SDK connections have no owner field, so the card falls back to the
              // connection's own creation date with no author.
              fallbackOwnerId=""
              fallbackDateCreated={new Date(connection.dateCreated)}
              onSelectRevision={selectFlow}
              onTitleCommit={saveRevisionTitle}
              onNewDraft={
                canUpdate ? () => setConfirmNewDraft(true) : undefined
              }
              onReviewPublish={() => setActiveTab("review")}
            />
          </Box>
        )}
        <TabsContent value="overview">
          <Box mt="5">
            <Flex align="center" justify="between" gap="2" mb="3">
              <Heading size="lg" as="h2" mb="0">
                Connection Details
              </Heading>
              {canUpdate && (
                <Link onClick={() => openEditSection("proxy")}>Edit</Link>
              )}
            </Flex>
            <SDKConnectionCredentialsCard connection={displayedConn} />
          </Box>
          <Box mt="5">
            <Heading size="lg" as="h2" mb="3">
              Settings
            </Heading>
            <SDKConnectionSettingsCards
              connection={displayedConn}
              canUpdate={canUpdate}
              onEditSection={openEditSection}
            />
          </Box>
        </TabsContent>
        <TabsContent value="webhooks">
          <Box mt="4">
            <SdkWebhooks
              connection={connection}
              approvalRequired={approvalRequired}
              onRevisionCreated={onRevisionCreated}
              selectedRevision={selectedRevision}
            />
          </Box>
        </TabsContent>
        {showRevisionUI && (
          <TabsContent value="review">
            <Box mt="4">
              <ReviewAndPublishTab<SDKConnectionRevisionSnapshot>
                revision={selectedRevision ?? displayRevision ?? null}
                allRevisions={allRevisions}
                currentState={liveSnapshot as SDKConnectionRevisionSnapshot}
                diffConfig={REVISION_SDK_CONNECTION_DIFF_CONFIG}
                entityName={displayedName}
                entityNoun="SDK Connection"
                requiresApproval={selectedRevisionRequiresApproval}
                canEditEntity={canUpdate}
                canBypassApproval={canAutoPublish}
                selectRevision={selectFlow}
                onPublish={handlePublish}
                onDiscard={handleDiscard}
                onReopen={handleReopen}
                onCompareRevisions={() => setShowCompareModal(true)}
                mutate={async () => {
                  await Promise.all([mutateRevisions(), mutate()]);
                }}
              />
            </Box>
          </TabsContent>
        )}
        <TabsContent value="implementation">
          <Box mt="4">
            <CodeSnippetModal
              connections={data.connections.map((c) =>
                c.id === displayedConn.id ? displayedConn : c,
              )}
              mutateConnections={mutate}
              sdkConnection={displayedConn}
              inline={true}
            />
          </Box>
        </TabsContent>
      </Tabs>

      {editSection === "overview" && (
        <EditSDKOverviewModal
          connection={displayedConn}
          close={closeEditSection}
          mutate={mutate}
          {...(hasApprovalsFeature
            ? {
                onRevisionCreated,
                openRevisions,
                allRevisions,
                selectedRevision,
                onSelectRevision: selectFlow,
                approvalRequired,
                canAutoPublish,
                metadataReviewRequired,
              }
            : {})}
        />
      )}
      {editSection !== null && editSection !== "overview" && (
        <EditSDKSettingsModal
          connection={displayedConn}
          close={closeEditSection}
          mutate={mutate}
          section={editSection}
          {...(hasApprovalsFeature
            ? {
                onRevisionCreated,
                openRevisions,
                allRevisions,
                selectedRevision,
                onSelectRevision: selectFlow,
                approvalRequired,
                canAutoPublish,
                metadataReviewRequired,
              }
            : {})}
        />
      )}
    </div>
  );
}
