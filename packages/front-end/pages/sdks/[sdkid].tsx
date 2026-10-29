import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { WebhookInterface } from "shared/types/webhook";
import {
  getConnectionSDKCapabilities,
  getSDKCapabilityVersion,
} from "shared/sdk-versioning";
import {
  parseSdkWebhookSnapshot,
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
  getSdkConnectionGoverningRules,
  getSdkConnectionReviewRules,
  sdkConnectionSettingsAfter,
} from "shared/enterprise";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAuth } from "@/services/auth";
import CreateSDKConnectionModal from "@/components/Features/SDKConnections/CreateSDKConnectionModal";
import SDKConnectionArchiveModal from "@/components/Features/SDKConnections/SDKConnectionArchiveModal";
import CompareRevisionsModal from "@/components/Revision/CompareRevisionsModal";
import SDKConnectionRevertModal from "@/components/Features/SDKConnections/SDKConnectionRevertModal";
import CodeSnippetModal from "@/components/Features/CodeSnippetModal";
import useSDKConnections from "@/hooks/useSDKConnections";
import useApi from "@/hooks/useApi";
import { useSDKConnectionRevision } from "@/hooks/useSDKConnectionRevision";
import PageHead from "@/components/Layout/PageHead";
import SdkWebhooks from "@/components/Features/SDKConnections/SdkWebhooks";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import SDKConnectionCredentialsCard from "@/components/Features/SDKConnections/SDKConnectionCredentialsCard";
import SDKConnectionSetup from "@/components/Features/SDKConnections/SDKConnectionSetup";
import { canBypassSdkConnectionApproval } from "@/components/Features/SDKConnections/edit-modals/useSdkConnectionRevisionFlow";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
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
import { PayloadSizeCallout } from "@/components/Features/SDKConnections/PayloadSizeNotices";
import { capitalizeFirstLetter } from "@/services/utils";

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
  const { data: webhookData, mutate: mutateWebhooks } = useApi<{
    webhooks?: WebhookInterface[];
  }>(`/sdk-connections/${sdkid}/webhooks`, { shouldRun: () => !!sdkid });

  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { user, hasCommercialFeature } = useUser();
  const settings = useOrgSettings();

  const [duplicateSource, setDuplicateSource] =
    useState<SDKConnectionInterface | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [confirmNewDraft, setConfirmNewDraft] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [revisionToRevert, setRevisionToRevert] = useState<Revision | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<string>("overview");

  const connection: SDKConnectionInterface | undefined =
    data?.connections?.find((conn) => conn.id === sdkid);

  const hasApprovalsFeature = hasCommercialFeature("require-approvals");

  const liveRules =
    hasApprovalsFeature && connection
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

  const revisionState = useSDKConnectionRevision(
    connection?.id,
    mutateLive,
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

  // Same rules the server checks: the live and destination scopes, minus
  // exemptions.
  const selectedRevisionReviewRules = useMemo(
    () =>
      selectedRevision && hasApprovalsFeature
        ? getSdkConnectionReviewRules(
            settings.approvalFlows,
            selectedRevision.target.snapshot as SDKConnectionRevisionSnapshot,
            selectedRevision.target.proposedChanges,
          )
        : [],
    [selectedRevision, hasApprovalsFeature, settings.approvalFlows],
  );
  const selectedRevisionRequiresApproval =
    selectedRevisionReviewRules.length > 0;

  const canAdminPublish =
    approvalRequired &&
    !!connection &&
    canBypassSdkConnectionApproval(
      permissionsUtil,
      user?.role,
      connection.projects ?? [],
    );
  const canAutoPublish = !approvalRequired || canAdminPublish;

  // Bypass for the selected draft needs authority in both the live projects
  // and the ones the draft moves the connection into.
  const canBypassSelectedRevision =
    !selectedRevisionRequiresApproval ||
    (!!connection &&
      canBypassSdkConnectionApproval(
        permissionsUtil,
        user?.role,
        connection.projects ?? [],
      ) &&
      canBypassSdkConnectionApproval(
        permissionsUtil,
        user?.role,
        selectedRevision
          ? (sdkConnectionSettingsAfter(
              selectedRevision.target.snapshot as SDKConnectionRevisionSnapshot,
              selectedRevision.target.proposedChanges,
            ).projects ?? [])
          : [],
      ));

  const displayRevision = useMemo(() => {
    if (selectedRevision) return selectedRevision;
    return [...allRevisions]
      .filter((r) => r.status === "merged")
      .sort(
        (a, b) =>
          new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
      )[0];
  }, [selectedRevision, allRevisions]);

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
  const canDelete =
    permissionsUtil.canDeleteSDKConnection(connection) &&
    !connection.managedBy?.type;
  const isExternallyManaged = !!connection.managedBy?.type;

  const showRevisionUI = hasRevisions;

  const displayedConn = showRevisionUI
    ? (displayedConnection ?? connection)
    : connection;
  const displayedName = displayedConn.name;
  const displayedArchived = !!displayedConn.archived;

  const supportsBucketingV2 =
    getConnectionSDKCapabilities(displayedConn).includes("bucketingV2");
  const bucketingV2IntroducedVersion = getSDKCapabilityVersion(
    displayedConn.languages?.[0],
    "bucketingV2",
  );
  const sdkDocSection = displayedConn.languages?.[0]
    ? languageMapping[displayedConn.languages[0]]?.docs
    : undefined;

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

      {revisionToRevert && liveSnapshot && (
        <SDKConnectionRevertModal
          liveSnapshot={{
            ...(liveSnapshot as SDKConnectionRevisionSnapshot),
            id: connection.id,
          }}
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
          }}
        />
      )}

      {showCompareModal && (
        <CompareRevisionsModal<SDKConnectionRevisionSnapshot>
          liveEntity={liveSnapshot as SDKConnectionRevisionSnapshot}
          entityId={connection.id}
          diffConfig={REVISION_SDK_CONNECTION_DIFF_CONFIG}
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
            <>
              <Badge color="gray" variant="soft" label="Not connected" />
              {canUpdate && <Link onClick={() => mutate()}>Retry</Link>}
            </>
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
          {(canUpdate || canDuplicate || canDelete) && (
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
              {canDuplicate && (
                <>
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
                  <DropdownMenuSeparator />
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
              {/* The backend only deletes a connection once LIVE is archived. */}
              {canDelete && connection.archived && (
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
              )}
            </DropdownMenu>
          )}
        </Flex>
      </Flex>

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

      <Tabs value={activeTab} onValueChange={setActiveTab} mt="4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="implementation">Implementation</TabsTrigger>
          {showRevisionUI && (
            <TabsTrigger value="review">Review &amp; Publish</TabsTrigger>
          )}
        </TabsList>
        {/* The Review & Publish tab renders its own revision header. */}
        {showRevisionUI && activeTab !== "review" && (
          <Box mt="4">
            <RevisionSummaryCard
              allRevisions={allRevisions}
              selectedRevision={selectedRevision}
              entityNoun="SDK Connection"
              hasRevisions={hasRevisions}
              canEditTitle={canUpdate}
              canEditDescription={canUpdate}
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
            <Heading size="lg" as="h2" mb="3">
              Keys
            </Heading>
            <SDKConnectionCredentialsCard
              connection={displayedConn}
              canUpdate={canUpdate}
              mutate={mutate}
            />
          </Box>
          <Box mt="6">
            <SDKConnectionSetup
              // Starts over from the viewed state when the revision or the
              // saved connection changes.
              key={`${selectedRevisionId ?? "live"}-${String(displayedConn.dateUpdated)}`}
              connection={displayedConn}
              mutate={mutate}
              canUpdate={canUpdate}
              onRevisionCreated={onRevisionCreated}
              openRevisions={openRevisions}
              allRevisions={allRevisions}
              selectedRevision={selectedRevision}
              onSelectRevision={selectFlow}
              approvalRequired={approvalRequired}
              canAutoPublish={canAutoPublish}
              metadataReviewRequired={metadataReviewRequired}
            />
          </Box>
        </TabsContent>
        <TabsContent value="webhooks">
          <Box mt="4">
            <SdkWebhooks
              connection={connection}
              approvalRequired={
                approvalRequired || selectedRevisionRequiresApproval
              }
              onRevisionCreated={onRevisionCreated}
              selectedRevision={showRevisionUI ? selectedRevision : null}
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
                reviewRules={selectedRevisionReviewRules}
                canEditEntity={canUpdate}
                canBypassApproval={canBypassSelectedRevision}
                selectRevision={selectFlow}
                onPublish={handlePublish}
                onDiscard={handleDiscard}
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
    </div>
  );
}
