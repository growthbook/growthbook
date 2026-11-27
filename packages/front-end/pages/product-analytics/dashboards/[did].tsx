import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiClockCounterClockwise, PiSparkle } from "react-icons/pi";
import { date } from "shared/dates";
import { useRouter } from "next/router";
import {
  DashboardInterface,
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardVersionInterface,
  diffDashboardContent,
} from "shared/enterprise";
import { withErrorBoundary } from "@sentry/nextjs";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import DashboardEditor from "@/enterprise/components/Dashboards/DashboardEditor";
import DashboardWorkspace from "@/enterprise/components/Dashboards/DashboardWorkspace";
import { useAuth } from "@/services/auth";
import DashboardSnapshotProvider from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import PageHead from "@/components/Layout/PageHead";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import PremiumCallout from "@/ui/PremiumCallout";
import DashboardDraftChanges from "@/enterprise/components/Dashboards/DashboardDraftChanges";
import Modal from "@/ui/Modal/Patterns/ModalStandard";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { DashboardCommentsProvider } from "@/enterprise/components/Dashboards/DashboardComments";
import DashboardAssistantRail, {
  ASSISTANT_RAIL_WIDTH,
} from "@/enterprise/components/Dashboards/DashboardAssistantRail";
import { useAISettings } from "@/hooks/useOrgSettings";
import DashboardBuilderView from "@/enterprise/components/Dashboards/DashboardBuilderView";

function SingleDashboardPage() {
  const router = useRouter();
  const { did } = router.query;
  const dashboardId = typeof did === "string" ? did : "";
  const { data, isLoading, error, mutate } = useApi<{
    dashboard: DashboardInterface;
  }>(`/dashboards/${dashboardId}`, {
    shouldRun: () => router.isReady && Boolean(dashboardId),
  });
  const dashboard = data?.dashboard;
  const [isEditing, setIsEditing] = useState(false);
  const [initialEditBlockIndex, setInitialEditBlockIndex] = useState<
    number | null
  >(null);
  const { hasCommercialFeature, userId, getUserDisplay } = useUser();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();

  const canUpdateDashboards = permissionsUtil.canCreateAnalyses(
    dashboard?.projects,
  );
  const isOwner = userId === dashboard?.userId || !dashboard?.userId;
  const isAdmin = permissionsUtil.canSuperDeleteReport();
  const canManage = isOwner || isAdmin;
  const canEdit =
    canManage || (dashboard.editLevel === "published" && canUpdateDashboards);

  // Editors change a shared draft; everyone opens on what is published.
  const { data: draftData, mutate: mutateDraft } = useApi<{
    draft: DashboardVersionInterface | null;
  }>(`/dashboards/${dashboardId}/draft`, {
    shouldRun: () => !!dashboard && !dashboard.isDraft && canEdit,
  });
  const draft = draftData?.draft ?? null;
  const hasDraft = !!draft;
  const [showDraft, setShowDraft] = useState(false);
  const [draftModal, setDraftModal] = useState<"publish" | "discard" | null>(
    null,
  );
  const [note, setNote] = useState("");
  // The version awaiting confirmation: restoring replaces the draft's content.
  const [restoreVersion, setRestoreVersion] = useState<number | null>(null);
  // Off: saved dashboards save live as before, unless a draft already exists.
  const builderOn = useFeatureIsOn<AppFeatures>("new-dashboard-builder");
  const { aiEnabled } = useAISettings();
  const [railOpen, setRailOpen] = useState(false);
  // A comment thread handed to the assistant; cleared once it is sent.
  const [aiMessage, setAiMessage] = useState<{ text: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // An earlier version shown read-only.
  const [preview, setPreview] = useState<DashboardVersionInterface | null>(
    null,
  );
  const { data: versionsData } = useApi<{
    versions: DashboardVersionInterface[];
  }>(`/dashboards/${dashboardId}/versions`, {
    shouldRun: () => !!dashboard?.publishedVersion && historyOpen,
  });
  const shown = useMemo(() => {
    if (!dashboard) return dashboard;
    if (preview) {
      // A version from before a setting existed must not show today's value for it.
      return {
        ...dashboard,
        globalControls: undefined,
        comparison: undefined,
        ...preview.content,
      };
    }
    return draft && (showDraft || isEditing)
      ? { ...dashboard, ...draft.content }
      : dashboard;
  }, [dashboard, draft, showDraft, isEditing, preview]);

  const [blocks, setBlocks] = useState<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>[]
  >([]);
  const [globalControls, setGlobalControls] =
    useState<DashboardInterface["globalControls"]>();
  const [dashboardComparison, setDashboardComparison] =
    useState<DashboardInterface["comparison"]>();
  useEffect(() => {
    setBlocks(shown?.blocks ?? []);
    setGlobalControls(shown?.globalControls);
    setDashboardComparison(shown?.comparison);
  }, [shown]);

  const enterEditModeForBlock = useCallback(
    (blockIndex: number) => {
      // The editor opens on the draft, where the same block may sit at another position.
      const block = blocks[blockIndex];
      const id = block && "id" in block ? block.id : null;
      const inDraft = draft?.content.blocks.findIndex((b) => b.id === id) ?? -1;
      setInitialEditBlockIndex(
        draft ? (inDraft === -1 ? null : inDraft) : blockIndex,
      );
      setIsEditing(true);
    },
    [blocks, draft],
  );

  const submitDashboard = useCallback(
    async ({
      method,
      dashboardId,
      data,
    }: {
      method: "PUT" | "POST";
      dashboardId?: string;
      data: {
        title?: DashboardInterface["title"];
        editLevel?: DashboardInterface["editLevel"];
        enableAutoUpdates?: DashboardInterface["enableAutoUpdates"];
        blocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
        userId?: string;
        globalControls?: DashboardInterface["globalControls"];
        comparison?: DashboardInterface["comparison"];
      };
    }) => {
      if (method === "PUT" && dashboardId && (builderOn || hasDraft)) {
        // Content goes to the draft; who can see and edit it is not versioned.
        const content = {
          title: data.title,
          blocks: data.blocks,
          globalControls: data.globalControls,
          // Undefined drops out of the body and reads as "leave alone".
          ...("comparison" in data
            ? { comparison: data.comparison ?? { enabled: false } }
            : {}),
        };
        const access = {
          editLevel: data.editLevel,
          enableAutoUpdates: data.enableAutoUpdates,
          userId: data.userId,
        };
        const has = (o: object) =>
          Object.values(o).some((v) => v !== undefined);
        if (has(content)) {
          const res = await apiCall<{ draft: DashboardVersionInterface }>(
            `/dashboards/${dashboardId}/draft`,
            { method: "PUT", body: JSON.stringify(content) },
          );
          await mutateDraft({ draft: res.draft }, { revalidate: false });
          setShowDraft(true);
        }
        if (has(access)) {
          const res = await apiCall<{ dashboard: DashboardInterface }>(
            `/dashboards/${dashboardId}`,
            { method: "PUT", body: JSON.stringify(access) },
          );
          await mutate({ dashboard: res.dashboard }, { revalidate: false });
        }
        return { dashboardId };
      }
      const res = (await apiCall(
        `/dashboards/${method === "PUT" ? dashboardId : ""}`,
        {
          method,
          body: JSON.stringify(
            method === "PUT"
              ? {
                  blocks: data.blocks,
                  title: data.title,
                  editLevel: data.editLevel,
                  enableAutoUpdates: data.enableAutoUpdates,
                  userId: data.userId,
                  globalControls: data.globalControls,
                  // Undefined drops out of the body and reads as "leave alone",
                  // so "off" must be explicit. Keyed on presence, not value.
                  ...("comparison" in data
                    ? { comparison: data.comparison ?? { enabled: false } }
                    : {}),
                }
              : data,
          ),
        },
      )) as { status: number; dashboard: DashboardInterface };
      if (res.status === 200) {
        await mutate(
          { dashboard: res.dashboard },
          {
            revalidate: false,
          },
        );
        return { dashboardId: res.dashboard.id };
      } else {
        throw new Error("Failed to save dashboard");
      }
    },
    [apiCall, mutate, mutateDraft, builderOn, hasDraft],
  );

  const memoizedSetBlock = useCallback(
    (i: number, block: (typeof blocks)[number]) => {
      if (!dashboard) return;
      const newBlocks = [...blocks.slice(0, i), block, ...blocks.slice(i + 1)];
      setBlocks(newBlocks);
      submitDashboard({
        method: "PUT",
        dashboardId: dashboard.id,
        data: {
          blocks: newBlocks,
        },
      });
    },
    [blocks, submitDashboard, dashboard],
  );

  if (!hasCommercialFeature("product-analytics-dashboards")) {
    return (
      <PremiumCallout
        id="product-analytics-single-dashboard"
        dismissible={false}
        commercialFeature="product-analytics-dashboards"
      >
        Use of Product Analytics Dashboards requires a paid plan
      </PremiumCallout>
    );
  }

  if (isLoading) {
    return <LoadingOverlay />;
  }

  if (error) {
    return <Callout status="error">An error occurred: {error.message}</Callout>;
  }

  if (!dashboard) {
    router.replace("/404");
    return null;
  }

  // Never published: only its owner can load it, and it is still being built.
  if (dashboard.isDraft) {
    return <DashboardBuilderView dashboard={dashboard} mutate={mutate} />;
  }

  const viewingDraft = !!draft && (showDraft || isEditing);
  const canUseAssistant =
    builderOn && canEdit && aiEnabled && hasCommercialFeature("ai-suggestions");
  const assistantOpen = railOpen && canUseAssistant && !preview && !isEditing;
  const changes = draft ? diffDashboardContent(dashboard, draft.content) : [];
  const draftCall = async (path: string, method: string, body?: unknown) => {
    await apiCall(`/dashboards/${dashboard.id}/draft${path}`, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    setShowDraft(false);
    setNote("");
    await Promise.all([mutate(), mutateDraft()]);
  };
  const restore = async (version: number) => {
    await apiCall(`/dashboards/${dashboard.id}/draft/restore`, {
      method: "POST",
      body: JSON.stringify({ version }),
    });
    await mutateDraft();
    setRestoreVersion(null);
    setPreview(null);
    setHistoryOpen(false);
    setShowDraft(true);
  };

  return (
    <div
      className="container-fluid pagecontents"
      style={assistantOpen ? { paddingRight: ASSISTANT_RAIL_WIDTH } : undefined}
    >
      {assistantOpen ? (
        <DashboardAssistantRail
          dashboardId={dashboard.id}
          dashboardTitle={(shown ?? dashboard).title}
          message={aiMessage}
          onMessageSent={() => setAiMessage(null)}
          onDraftChange={() => {
            void mutateDraft();
            setShowDraft(true);
          }}
          onClose={() => setRailOpen(false)}
        />
      ) : null}
      <PageHead
        breadcrumb={[
          {
            display: "Product Analytics",
            href: "/product-analytics/dashboards",
          },
          { display: (shown ?? dashboard).title },
        ]}
      />
      {draft && draftModal === "publish" ? (
        <Modal
          open
          size="md"
          trackingEventModalType="publish-dashboard-draft"
          header={`Publish Version ${draft.version}`}
          cta="Publish"
          closeCta="Cancel"
          close={() => setDraftModal(null)}
          submit={() =>
            draftCall("/publish", "POST", note.trim() ? { note } : {})
          }
        >
          <DashboardDraftChanges
            dashboard={dashboard}
            draft={draft}
            note={note}
            setNote={setNote}
            onRevert={async (target) => {
              await apiCall(`/dashboards/${dashboard.id}/draft/revert`, {
                method: "POST",
                body: JSON.stringify(target),
              });
              await mutateDraft();
            }}
          />
        </Modal>
      ) : null}
      {draft && draftModal === "discard" ? (
        <Modal
          open
          size="md"
          trackingEventModalType="discard-dashboard-draft"
          header="Discard Draft"
          cta="Discard"
          ctaColor="red"
          closeCta="Cancel"
          close={() => setDraftModal(null)}
          submit={() => draftCall("", "DELETE")}
        >
          <Text>
            This removes every unpublished change, for everyone editing this
            dashboard. The published version stays as it is.
          </Text>
        </Modal>
      ) : null}
      {restoreVersion !== null ? (
        <Modal
          open
          size="md"
          trackingEventModalType="restore-dashboard-version"
          header={`Restore Version ${restoreVersion}`}
          cta="Restore to draft"
          closeCta="Cancel"
          close={() => setRestoreVersion(null)}
          submit={() => restore(restoreVersion)}
        >
          <Text>
            {changes.length > 0
              ? "This replaces the draft's unpublished changes with this version's content."
              : "This copies this version's content into the draft."}{" "}
            Nothing changes for viewers until the draft is published.
          </Text>
        </Modal>
      ) : null}
      {historyOpen ? (
        <Modal
          open
          size="md"
          trackingEventModalType="dashboard-version-history"
          header="Version History"
          closeCta="Close"
          close={() => setHistoryOpen(false)}
        >
          <Flex direction="column" gap="3">
            {versionsData ? null : (
              <Text size="sm" color="text-low">
                Loading…
              </Text>
            )}
            {(versionsData?.versions ?? []).map((v) => {
              const current = v.version === dashboard.publishedVersion;
              return (
                <Flex key={v.id} align="start" gap="3">
                  <Badge
                    color={v.status === "draft" ? "violet" : "gray"}
                    variant="soft"
                    radius="full"
                    label={`v${v.version}`}
                  />
                  <Flex direction="column" flexGrow="1" minWidth="0">
                    <Text size="sm" weight="medium">
                      {v.status === "draft"
                        ? "Draft, not published"
                        : `Published ${date(v.datePublished ?? v.dateCreated)}${
                            v.publishedBy
                              ? ` by ${getUserDisplay(v.publishedBy)}`
                              : ""
                          }${current ? " · Current" : ""}`}
                    </Text>
                    {v.note ? (
                      <Text size="sm" color="text-low" whiteSpace="pre-wrap">
                        {v.note}
                      </Text>
                    ) : null}
                  </Flex>
                  {v.status === "published" && !current ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setPreview(v);
                          setHistoryOpen(false);
                        }}
                      >
                        Preview
                      </Button>
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRestoreVersion(v.version)}
                        >
                          Restore to draft
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </Flex>
              );
            })}
          </Flex>
        </Modal>
      ) : null}
      {preview ? (
        <Flex
          align="center"
          gap="3"
          wrap="wrap"
          px="3"
          py="2"
          mb="3"
          style={{
            background: "var(--amber-a3)",
            borderRadius: "var(--radius-3)",
          }}
        >
          <Flex flexGrow="1">
            <Text size="sm">
              Previewing v{preview.version}, published{" "}
              {date(preview.datePublished ?? preview.dateCreated)}. Nothing here
              can be changed.
            </Text>
          </Flex>
          <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
            Back to current
          </Button>
          {canEdit ? (
            <Button
              size="sm"
              onClick={() => setRestoreVersion(preview.version)}
            >
              Restore to draft
            </Button>
          ) : null}
        </Flex>
      ) : null}
      {builderOn &&
      (dashboard.publishedVersion || canUseAssistant) &&
      !isEditing &&
      !preview ? (
        <Flex align="center" justify="end" gap="2" mb="2">
          {dashboard.publishedVersion ? (
            <>
              <Badge
                color="gray"
                variant="soft"
                radius="full"
                label={`v${dashboard.publishedVersion}`}
              />
              <Button
                variant="ghost"
                size="sm"
                icon={<PiClockCounterClockwise />}
                onClick={() => setHistoryOpen(true)}
              >
                History
              </Button>
            </>
          ) : null}
          {canUseAssistant && !railOpen ? (
            <Button
              variant="outline"
              size="sm"
              icon={<PiSparkle />}
              onClick={() => setRailOpen(true)}
            >
              AI Assistant
            </Button>
          ) : null}
        </Flex>
      ) : null}
      {draft && !preview ? (
        <Flex
          align="center"
          gap="3"
          wrap="wrap"
          px="3"
          py="2"
          mb="3"
          style={{
            background: "var(--violet-a3)",
            borderRadius: "var(--radius-3)",
          }}
        >
          <Badge
            color="violet"
            variant="soft"
            radius="full"
            label={`Draft v${draft.version}`}
          />
          <Flex flexGrow="1">
            <Text size="sm">
              {changes.length === 1
                ? "1 unpublished change"
                : `${changes.length} unpublished changes`}
              {viewingDraft
                ? ". You are viewing the draft."
                : `. You are viewing published v${draft.version - 1}.`}
            </Text>
          </Flex>
          {isEditing ? null : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDraft(!showDraft)}
              >
                {showDraft ? "View published" : "View draft"}
              </Button>
              <Button
                variant="ghost"
                color="red"
                size="sm"
                onClick={() => setDraftModal("discard")}
              >
                Discard
              </Button>
              <Button size="sm" onClick={() => setDraftModal("publish")}>
                Publish v{draft.version}
              </Button>
            </>
          )}
        </Flex>
      ) : null}
      {viewingDraft && !isEditing && !preview ? (
        // Marks what the draft changed; the list is in the publish prompt.
        <style>
          {changes
            .flatMap((c) =>
              c.blockId && c.type !== "block-removed"
                ? [`[data-block-id="${CSS.escape(c.blockId)}"]`]
                : [],
            )
            .join(",") +
            "{outline:2px dashed var(--violet-8);outline-offset:2px;border-radius:var(--radius-3)}"}
        </style>
      ) : null}
      {showUpgradeModal && (
        <UpgradeModal
          close={() => setShowUpgradeModal(false)}
          source="product-analytics-single-dashboard"
          commercialFeature="product-analytics-dashboards"
        />
      )}
      <DashboardCommentsProvider
        enabled={builderOn}
        canComment={permissionsUtil.canAddComment(dashboard.projects ?? [])}
        dashboardId={dashboard.id}
        version={
          preview?.version ??
          (viewingDraft && draft
            ? draft.version
            : (dashboard.publishedVersion ?? 1))
        }
        onSendToAI={
          canUseAssistant && !preview
            ? (text) => {
                setRailOpen(true);
                setAiMessage({ text });
              }
            : undefined
        }
      >
        <DashboardSnapshotProvider
          dashboard={shown ?? dashboard}
          mutateDefinitions={mutate}
          version={preview?.version}
        >
          {isEditing && dashboard ? (
            <DashboardWorkspace
              experiment={null}
              dashboard={shown ?? dashboard}
              submitDashboard={({ method, dashboardId, data }) =>
                submitDashboard({ method, dashboardId, data })
              }
              mutate={mutate}
              close={() => {
                setIsEditing(false);
                setInitialEditBlockIndex(null);
              }}
              isTabActive={true}
              initialEditBlockIndex={initialEditBlockIndex}
              onConsumeInitialEditBlockIndex={() =>
                setInitialEditBlockIndex(null)
              }
            />
          ) : (
            <DashboardEditor
              isTabActive
              id={dashboard.id}
              initialEditLevel={dashboard.editLevel}
              ownerId={dashboard.userId}
              initialShareLevel={dashboard.shareLevel}
              dashboardOwnerId={dashboard.userId}
              isGeneralDashboard={true}
              isEditing={false}
              title={(shown ?? dashboard).title}
              blocks={blocks}
              globalControls={globalControls}
              enableAutoUpdates={dashboard.enableAutoUpdates}
              setBlock={canEdit && !preview ? memoizedSetBlock : undefined}
              projects={dashboard.projects ? dashboard.projects : []}
              mutate={mutate}
              updateSchedule={dashboard.updateSchedule || undefined}
              nextUpdate={dashboard.nextUpdate}
              dashboardLastUpdated={dashboard.lastUpdated}
              setIsEditing={preview ? undefined : setIsEditing}
              enterEditModeForBlock={
                preview ? undefined : enterEditModeForBlock
              }
              onGlobalControlsChange={
                preview
                  ? undefined
                  : async (globalControls, controlBlocks) => {
                      setGlobalControls(globalControls);
                      if (controlBlocks) {
                        setBlocks(controlBlocks);
                      }
                      await submitDashboard({
                        method: "PUT",
                        dashboardId: dashboard.id,
                        data: {
                          globalControls,
                          // The draft enrolls its own blocks; these are the published ones.
                          ...(controlBlocks && !builderOn && !hasDraft
                            ? { blocks: controlBlocks }
                            : {}),
                        },
                      });
                    }
              }
              dashboardComparison={dashboardComparison}
              onDashboardComparisonChange={
                preview
                  ? undefined
                  : async (comparison) => {
                      // Turning compare off has to persist `{ enabled: false }` rather
                      // than `undefined`: the PUT body drops undefined keys, which the
                      // model reads as "leave this field alone". `resolveBlockComparison`
                      // treats a disabled comparison and an absent one identically.
                      const next = comparison ?? { enabled: false };
                      setDashboardComparison(next);
                      await submitDashboard({
                        method: "PUT",
                        dashboardId: dashboard.id,
                        data: { comparison: next },
                      });
                    }
              }
            />
          )}
        </DashboardSnapshotProvider>
      </DashboardCommentsProvider>
    </div>
  );
}

export default withErrorBoundary(SingleDashboardPage, {
  fallback: <Callout status="error">Failed to load dashboard</Callout>,
});
