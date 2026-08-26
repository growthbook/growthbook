import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  getConnectionSDKCapabilities,
  getSDKCapabilityVersion,
} from "shared/sdk-versioning";
import {
  SDKConnectionRevisionSnapshot,
  SDKConnectionSettingsRevisionSnapshot,
} from "shared/validators";
import { useRouter } from "next/router";
import React, { useEffect, useMemo, useState } from "react";
import { PiGitDiff, PiDotsThreeVertical } from "react-icons/pi";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  Revision,
  applyTopLevelPatchOps,
  patchOpsToPartial,
  getSdkConnectionApprovalRule,
  isSdkConnectionRevisionMetadataOnly,
} from "shared/enterprise";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAuth } from "@/services/auth";
import SDKConnectionForm from "@/components/Features/SDKConnections/SDKConnectionForm";
import SDKConnectionArchiveModal from "@/components/Features/SDKConnections/SDKConnectionArchiveModal";
import CompareSDKConnectionRevisionsModal from "@/components/Features/SDKConnections/CompareSDKConnectionRevisionsModal";
import CodeSnippetModal from "@/components/Features/CodeSnippetModal";
import useSDKConnections from "@/hooks/useSDKConnections";
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
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Modal from "@/components/Modal";
import RevisionDropdown from "@/components/Revision/RevisionDropdown";
import RevisionDetail from "@/components/Revision/RevisionDetail";
import RevisionStatusPanel from "@/components/Revision/RevisionStatusPanel";
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

// Build the revision snapshot for a live connection (no webhooks — the live
// snapshot is used only as the baseline for diff rendering; webhooks are
// fetched separately and not needed here).
function flattenConnection(
  connection: SDKConnectionInterface,
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
    proxyEnabled: connection.proxy?.enabled,
    proxyHost: connection.proxy?.host,
    ...(connection.archived !== undefined && { archived: connection.archived }),
  };
  return { sdkConnection: settings, sdkWebhooks: [] };
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

// Build the edit form's initialValue from the live connection overlaid with a
// draft's proposed (flattened) changes. Patches target /sdkConnection as a
// coarse-replacement op, so we extract the sdkConnection portion.
function buildEditInitialValue(
  connection: SDKConnectionInterface,
  revision: Revision | null,
): Partial<SDKConnectionInterface> {
  if (!revision) return connection;
  const proposedPartial = patchOpsToPartial(
    revision.target.proposedChanges,
  ) as Partial<SDKConnectionRevisionSnapshot>;
  const settings = proposedPartial.sdkConnection ?? {};
  return overlayFlattenedOnConnection(
    connection,
    settings as Record<string, unknown>,
  );
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

  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { user, hasCommercialFeature } = useUser();
  const settings = useOrgSettings();

  const [modalState, setModalState] = useState<{
    mode: "edit" | "create" | "closed";
    initialValue?: Partial<SDKConnectionInterface>;
  }>({ mode: "closed" });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showChangesModal, setShowChangesModal] = useState(false);
  const [confirmNewDraft, setConfirmNewDraft] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
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
    userOpenFlow: userOpenRevision,
  } = revisionState;

  const isDraft =
    selectedRevision &&
    (selectedRevision.status === "draft" ||
      selectedRevision.status === "pending-review" ||
      selectedRevision.status === "changes-requested" ||
      selectedRevision.status === "approved");
  const isDiscarded =
    selectedRevision && selectedRevision.status === "discarded";
  const isLive = !selectedRevision;
  const hasRevisions = allRevisions.length > 0;

  // Per-revision approval gate: a metadata-only revision (name only) can be
  // published without review when `requireMetadataReview` is off. Mirrors the
  // server-side rule in the sdk-connection adapter.
  const selectedRevisionRequiresApproval =
    !!selectedRevision &&
    approvalRequired &&
    (metadataReviewRequired ||
      !isSdkConnectionRevisionMetadataOnly(
        selectedRevision.target.proposedChanges,
      ));

  const canAdminPublish =
    approvalRequired &&
    !!connection &&
    (user?.role === "admin" ||
      (connection.projects.length
        ? connection.projects.every((p) =>
            permissionsUtil.canBypassApprovalChecks({ project: p || "" }),
          )
        : permissionsUtil.canBypassApprovalChecks({ project: "" })));
  const canAutoPublish = !approvalRequired || canAdminPublish;

  // Close the changes modal when the selected revision is deselected.
  useEffect(() => {
    if (!selectedRevision) setShowChangesModal(false);
  }, [selectedRevision]);

  const displayRevision = useMemo(() => {
    if (selectedRevision) return selectedRevision;
    return [...allRevisions]
      .filter((r) => r.status === "merged")
      .sort(
        (a, b) =>
          new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
      )[0];
  }, [selectedRevision, allRevisions]);

  const revisionNumber = useMemo(() => {
    const getNumber = (revision: Revision | undefined) => {
      if (revision?.version) return revision.version;
      const sorted = [...allRevisions].sort(
        (a, b) =>
          new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
      );
      if (revision) return sorted.findIndex((r) => r.id === revision.id) + 1;
      return sorted.length;
    };
    if (selectedRevision) return getNumber(selectedRevision);
    if (userOpenRevision) return getNumber(userOpenRevision);
    return getNumber(displayRevision);
  }, [selectedRevision, userOpenRevision, displayRevision, allRevisions]);

  // The connection shape representing the selected revision's effective state
  // (snapshot + proposed changes), overlaid on the live connection so secret
  // fields stay intact. Falls back to the live connection when nothing is
  // selected. Used to drive the page's visual representation.
  const displayedConnection = useMemo(() => {
    if (!connection) return undefined;
    return buildDisplayedConnection(connection, selectedRevision ?? null);
  }, [connection, selectedRevision]);

  const liveSnapshot = useMemo(
    () => (connection ? flattenConnection(connection) : undefined),
    [connection],
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
  const canReview = canUpdate;
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

  const openEditForm = () => {
    setModalState({
      mode: "edit",
      initialValue: hasApprovalsFeature
        ? buildEditInitialValue(connection, selectedRevision)
        : connection,
    });
  };

  // Per-section edit modal routing. Each section opens its dedicated modal.
  const openEditSection = (section: SDKConnectionEditSection | "overview") => {
    setEditSection(section);
  };
  const closeEditSection = () => setEditSection(null);

  return (
    <div className="contents container pagecontents">
      {modalState.mode !== "closed" && (
        <SDKConnectionForm
          close={() => setModalState({ mode: "closed" })}
          mutate={mutate}
          initialValue={modalState.initialValue}
          edit={modalState.mode === "edit"}
          {...(modalState.mode === "edit" && hasApprovalsFeature
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

      {showChangesModal && selectedRevision && liveSnapshot && (
        <Modal
          header={selectedRevision.title || `Revision ${revisionNumber}`}
          trackingEventModalType="sdk-connection-revision-changes"
          close={() => setShowChangesModal(false)}
          open={showChangesModal}
          dismissible
          size="max"
          hideCta={true}
          closeCta="Close"
          useRadixButton={true}
        >
          <RevisionDetail<SDKConnectionRevisionSnapshot>
            diffConfig={REVISION_SDK_CONNECTION_DIFF_CONFIG}
            revision={selectedRevision}
            currentState={liveSnapshot}
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
            requiresApproval={selectedRevisionRequiresApproval}
            canReview={canReview}
            closeModal={() => setShowChangesModal(false)}
          />
        </Modal>
      )}

      {showCompareModal && (
        <CompareSDKConnectionRevisionsModal
          allRevisions={allRevisions}
          onClose={() => setShowCompareModal(false)}
          requiresApproval={approvalRequired}
        />
      )}

      {confirmNewDraft && (
        <Modal
          trackingEventModalType="create-new-sdk-connection-draft"
          open={true}
          close={() => setConfirmNewDraft(false)}
          header="Create New Draft"
          cta="Create Draft"
          loading={creatingDraft}
          useRadixButton={true}
          submit={async () => {
            setCreatingDraft(true);
            try {
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
            } finally {
              setCreatingDraft(false);
            }
          }}
        >
          Create a new draft to make changes to this SDK connection. The live
          version stays unchanged until the draft is published.
        </Modal>
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
          <Heading size="x-large" as="h1" mb="0">
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
                    openEditForm();
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
                      setModalState({
                        mode: "create",
                        initialValue: connection,
                      });
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

      {showRevisionUI && (
        <RevisionStatusPanel
          entityNoun="SDK connection"
          allRevisions={allRevisions}
          selectedRevision={selectedRevision}
          displayRevision={displayRevision}
          revisionNumber={revisionNumber}
          metadataReviewRequired={metadataReviewRequired}
          currentUserId={user?.id}
          fallbackAuthorId=""
          fallbackCreatedDate={connection.dateCreated}
          selectFlow={selectFlow}
          onSaveTitle={saveRevisionTitle}
          titleRowExtra={
            <Button
              variant="ghost"
              size="sm"
              icon={<PiGitDiff />}
              onClick={() => setShowCompareModal(true)}
              style={{ position: "relative", top: -5 }}
            >
              Compare revisions
            </Button>
          }
          actions={
            <>
              {isLive && canUpdate && (
                <Button
                  onClick={() => setConfirmNewDraft(true)}
                  size="sm"
                  variant="soft"
                >
                  New Draft
                </Button>
              )}
              {isDiscarded && displayRevision && (
                <Button
                  onClick={() => handleReopen(displayRevision.id)}
                  size="sm"
                >
                  Reopen
                </Button>
              )}
              {isDraft &&
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
              {isDraft && (
                <Button onClick={() => setShowChangesModal(true)} size="sm">
                  {selectedRevisionRequiresApproval
                    ? selectedRevision?.status === "draft"
                      ? "Request Approval to Publish"
                      : selectedRevision?.status === "pending-review"
                        ? "View Approval Request"
                        : "View Changes"
                    : "Review & Publish"}
                </Button>
              )}
            </>
          }
        />
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} mt="4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="implementation">Implementation</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Box mt="5">
            <Flex align="center" justify="between" gap="2" mb="3">
              <Heading size="large" as="h2" mb="0">
                Connection Details
              </Heading>
              {canUpdate && (
                <Link onClick={() => openEditSection("connection")}>Edit</Link>
              )}
            </Flex>
            <SDKConnectionCredentialsCard connection={displayedConn} />
          </Box>
          <Box mt="5">
            <Heading size="large" as="h2" mb="3">
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
