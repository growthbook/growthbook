import { Box, Flex } from "@radix-ui/themes";
import {
  KeyboardEvent,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { BsStars } from "react-icons/bs";
import {
  PiChartLine,
  PiCloudArrowUp,
  PiDatabase,
  PiPencilSimple,
} from "react-icons/pi";
import {
  DashboardDraftOpInput,
  DashboardInterface,
  DashboardVersionInterface,
} from "shared/enterprise";
import type { AIChatMention } from "shared/ai-chat";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { useAIChat } from "@/enterprise/hooks/useAIChat";
import { useAutoScroll } from "@/enterprise/components/AIChat/useAutoScroll";
import { LOCALSTORAGE_EXPLORER_DATASOURCE_KEY } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import DashboardEditor from "./DashboardEditor";
import DashboardSnapshotProvider, {
  DashboardSnapshotContext,
} from "./DashboardSnapshotProvider";
import DashboardBuilderRail, { BuilderMode } from "./DashboardBuilderRail";
import { takeDashboardBuilderHandoff } from "./dashboardBuilderHandoff";
import { isBuilderWriteTool } from "./dashboardBuilderSteps";
import styles from "./DashboardBuilder.module.scss";

// Block results are fetched per dashboard; a draft write means there may be new ones.
function RefreshBlockData({ stamp }: { stamp: string }) {
  const { mutateSnapshotsMap } = useContext(DashboardSnapshotContext);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void mutateSnapshotsMap();
  }, [stamp, mutateSnapshotsMap]);
  return null;
}

// The model streams a block's arguments before the call starts; its title is in there.
function streamedTitle(preview?: string): string {
  const match = preview?.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  return match ? match[1].replace(/\\(.)/g, "$1") : "";
}

function Title({
  title,
  onRename,
}: {
  title: string;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const commit = () => {
    setEditing(false);
    const next = value.trim();
    if (next && next !== title) onRename(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") setEditing(false);
  };
  return (
    <Heading as="h1" size="lg" weight="semibold">
      {editing ? (
        <input
          className={styles.titleInput}
          aria-label="Dashboard name"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      ) : (
        <button
          type="button"
          className={styles.titleButton}
          title="Click to rename · Enter to save"
          onClick={() => {
            setValue(title);
            setEditing(true);
          }}
        >
          <span>{title}</span>
          <PiPencilSimple className={styles.pen} size={14} />
        </button>
      )}
    </Heading>
  );
}

export default function DashboardBuilderView({
  dashboard,
  mutate,
}: {
  dashboard: DashboardInterface;
  mutate: () => Promise<unknown> | void;
}) {
  const { apiCall } = useAuth();
  const { defaultAIModel } = useAISettings();
  const { getDatasourceById } = useDefinitions();
  const handoffRef = useRef(takeDashboardBuilderHandoff(dashboard.id));
  const [mode, setMode] = useState<BuilderMode>(
    handoffRef.current?.mode ?? "build",
  );
  const [railOpen, setRailOpen] = useState(true);
  const [explorerDatasourceId] = useLocalStorage<string>(
    LOCALSTORAGE_EXPLORER_DATASOURCE_KEY,
    "",
  );
  // Kept per dashboard so a reload keeps building from the same Data Source.
  const [datasourceId, setDatasourceId] = useLocalStorage<string>(
    `dashboard-builder-datasource:${dashboard.id}`,
    handoffRef.current?.datasourceId || explorerDatasourceId,
  );
  useEffect(() => {
    const picked = handoffRef.current?.datasourceId;
    if (picked) setDatasourceId(picked);
  }, [setDatasourceId]);
  const datasourceName = getDatasourceById(datasourceId)?.name ?? "";
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: draftData,
    isLoading: draftLoading,
    mutate: mutateDraft,
  } = useApi<{ draft: DashboardVersionInterface | null }>(
    `/dashboards/${dashboard.id}/draft`,
  );
  const draft = draftData?.draft ?? null;
  const content = draft?.content ?? dashboard;

  const pendingMentionsRef = useRef<AIChatMention[]>([]);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const buildRequestBody = useCallback(
    (message: string, conversationId: string) => {
      const mentions = pendingMentionsRef.current;
      pendingMentionsRef.current = [];
      return {
        message,
        conversationId,
        dashboardId: dashboard.id,
        datasourceId,
        mode: modeRef.current,
        model: defaultAIModel,
        ...(mentions.length ? { mentions } : {}),
      };
    },
    [dashboard.id, datasourceId, defaultAIModel],
  );

  const {
    messages,
    activeTurnItems,
    displayedTextMap,
    sendMessage,
    cancelGeneration,
    loading,
    isLocalStream,
    error,
    input,
    setInput,
    conversationId,
  } = useAIChat({
    endpoint: "/dashboards/chat",
    buildRequestBody,
    conversationStorageKey: `dashboard-builder-chat:${dashboard.id}`,
    getConversationEndpoint: (cid) => `/dashboards/chat/${cid}`,
    getCancelEndpoint: (cid) => `/dashboards/chat/${cid}/cancel`,
    onSSEEvent: (event) => {
      if (
        event.type === "tool-call-end" &&
        isBuilderWriteTool(String(event.data.toolName))
      ) {
        void mutateDraft();
      }
    },
  });

  const { scrollContainerRef, messagesEndRef, handleScroll, resumeAutoScroll } =
    useAutoScroll({
      messages,
      activeTurnItems,
      displayedTextMap,
      conversationId,
    });

  const send = useCallback(
    (text: string, mentions: AIChatMention[] = []) => {
      if (!text.trim()) return;
      pendingMentionsRef.current = mentions;
      resumeAutoScroll();
      sendMessage(text, { mentions });
    },
    [resumeAutoScroll, sendMessage],
  );

  useEffect(() => {
    const handoff = handoffRef.current;
    if (!handoff) return;
    handoffRef.current = null;
    send(handoff.text, handoff.mentions);
  }, [send]);

  // A build that finished while this tab was polling still needs its last blocks.
  const wasLoading = useRef(false);
  useEffect(() => {
    if (wasLoading.current && !loading) void mutateDraft();
    wasLoading.current = loading;
  }, [loading, mutateDraft]);

  const buildingBlocks = activeTurnItems.flatMap((item) =>
    item.kind === "tool-status" &&
    item.toolName === "addBlock" &&
    item.status === "running"
      ? [
          {
            id: item.toolCallId,
            title:
              (typeof item.toolInput?.title === "string"
                ? item.toolInput.title
                : streamedTitle(item.argsTextPreview)) || "New block",
          },
        ]
      : [],
  );
  const building = loading && mode === "build";
  const blockCount = content.blocks.length;

  const editDraft = async (op: DashboardDraftOpInput) => {
    setActionError(null);
    try {
      await apiCall(`/dashboards/${dashboard.id}/draft/ops`, {
        method: "POST",
        body: JSON.stringify(op),
      });
      await mutateDraft();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const publish = async () => {
    setPublishing(true);
    setActionError(null);
    try {
      await apiCall(`/dashboards/${dashboard.id}/draft/publish`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await mutate();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      setPublishing(false);
    }
  };

  if (draftLoading) return <LoadingOverlay />;

  return (
    <Flex
      // Fills the page frame to its top, right and bottom edges so the rail sits flush.
      style={{
        height: "calc(100vh - var(--page-top-offset))",
        marginTop: "calc(-1 * var(--page-top-padding))",
        marginRight: "calc(-1 * var(--page-padding))",
        marginBottom: "calc(-1 * var(--page-bottom-padding))",
        minHeight: 0,
      }}
    >
      <PageHead
        breadcrumb={[
          { display: "Product Analytics", href: "/product-analytics/explore" },
          { display: "Dashboards", href: "/product-analytics/dashboards" },
          { display: content.title },
        ]}
      />
      <Box
        flexGrow="1"
        minWidth="0"
        pr="5"
        pb="6"
        style={{ overflowY: "auto", paddingTop: "var(--page-top-padding)" }}
      >
        <Flex align="center" gap="3" mb="3" wrap="wrap">
          <span className={styles.titleTile}>
            <PiChartLine size={18} />
          </span>
          <Flex
            direction="column"
            gap="1"
            flexGrow="1"
            flexBasis="320px"
            minWidth="0"
          >
            <Flex align="center" gap="2" minWidth="0">
              {/* The pull-left lives here: on the button it would shrink its own box. */}
              <Box minWidth="0" ml="-2">
                <Title
                  title={content.title}
                  onRename={(title) =>
                    editDraft({ op: "set-settings", settings: { title } })
                  }
                />
              </Box>
              <Badge
                variant="soft"
                color="violet"
                radius="full"
                style={{ flexShrink: 0 }}
                label={
                  <Flex align="center" gap="1">
                    <PiPencilSimple />
                    Draft
                    <Text size="sm" color="text-low">
                      · not published
                    </Text>
                  </Flex>
                }
              />
            </Flex>
            <Flex align="center" gap="3" wrap="wrap">
              {datasourceName ? (
                <Flex align="center" gap="1">
                  <PiDatabase color="var(--slate-10)" />
                  <Text size="sm" color="text-low">
                    {datasourceName}
                  </Text>
                </Flex>
              ) : null}
              <Text size="sm" color="text-low">
                {blockCount} {blockCount === 1 ? "block" : "blocks"}
              </Text>
              <Text size="sm" color="text-low">
                {building ? "AI Assistant is building…" : "Draft autosaved"}
              </Text>
            </Flex>
          </Flex>
          {!railOpen ? (
            <Button
              variant="outline"
              icon={<BsStars />}
              onClick={() => setRailOpen(true)}
            >
              AI Assistant
            </Button>
          ) : null}
          <Button
            icon={<PiCloudArrowUp />}
            onClick={publish}
            loading={publishing}
            disabled={loading || blockCount === 0}
          >
            Publish v1
          </Button>
        </Flex>

        {actionError ? (
          <Callout status="error" mb="3">
            {actionError}
          </Callout>
        ) : null}

        {blockCount > 0 ? (
          <DashboardSnapshotProvider
            dashboard={{ ...dashboard, ...content }}
            mutateDefinitions={mutateDraft}
          >
            <RefreshBlockData stamp={String(draft?.dateUpdated ?? "")} />
            <DashboardEditor
              hideHeader
              isTabActive
              id={dashboard.id}
              initialEditLevel={dashboard.editLevel}
              ownerId={dashboard.userId}
              initialShareLevel={dashboard.shareLevel}
              dashboardOwnerId={dashboard.userId}
              isGeneralDashboard={true}
              isEditing={false}
              title={content.title}
              blocks={content.blocks}
              globalControls={content.globalControls}
              enableAutoUpdates={dashboard.enableAutoUpdates}
              setBlock={undefined}
              projects={dashboard.projects ?? []}
              mutate={() => void mutateDraft()}
              updateSchedule={dashboard.updateSchedule || undefined}
              nextUpdate={dashboard.nextUpdate}
              dashboardLastUpdated={dashboard.lastUpdated}
              dashboardComparison={content.comparison}
            />
          </DashboardSnapshotProvider>
        ) : buildingBlocks.length === 0 ? (
          <Flex
            direction="column"
            align="center"
            gap="2"
            p="8"
            className={styles.placeholder}
          >
            <Text weight="semibold">
              {building ? "Planning your dashboard…" : "No blocks yet"}
            </Text>
            <Text color="text-low" size="sm">
              {building
                ? "Blocks appear here one at a time as the AI Assistant builds them."
                : "Describe what you want in the AI Assistant panel to start building."}
            </Text>
          </Flex>
        ) : null}

        <Flex direction="column" gap="3" mt="3">
          {buildingBlocks.map((block) => (
            <Flex
              key={block.id}
              direction="column"
              gap="2"
              p="4"
              className={styles.placeholder}
            >
              <Text weight="semibold">{block.title}</Text>
              <Flex align="center" gap="2">
                <BsStars className={styles.pulse} color="var(--violet-11)" />
                <Text color="text-low" size="sm">
                  AI Assistant is building this block…
                </Text>
              </Flex>
              <div className={styles.shimmer} />
            </Flex>
          ))}
        </Flex>
      </Box>

      {railOpen ? (
        <DashboardBuilderRail
          dashboardTitle={content.title}
          datasourceName={datasourceName}
          messages={messages}
          activeTurnItems={activeTurnItems}
          displayedTextMap={displayedTextMap}
          loading={loading}
          isLocalStream={isLocalStream}
          error={error}
          mode={mode}
          setMode={setMode}
          input={input}
          setInput={setInput}
          onSend={send}
          onCancel={cancelGeneration}
          onClose={() => setRailOpen(false)}
          scrollContainerRef={scrollContainerRef}
          messagesEndRef={messagesEndRef}
          onScroll={handleScroll}
        />
      ) : null}
    </Flex>
  );
}
