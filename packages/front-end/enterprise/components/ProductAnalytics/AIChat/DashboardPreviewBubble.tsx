import { useCallback, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  DEFAULT_DASHBOARD_GLOBAL_CONTROLS,
  type DashboardBlockInterface,
  type DashboardBlockInterfaceOrData,
  type DashboardInterface,
} from "shared/enterprise";
import { PiCheckCircleFill, PiSparkleFill } from "react-icons/pi";
import Link from "next/link";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import Callout from "@/ui/Callout";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import DashboardSnapshotProvider from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import DashboardEditor, {
  getGridKeyForBlock,
} from "@/enterprise/components/Dashboards/DashboardEditor";
import styles from "./DashboardPreviewBubble.module.scss";

/**
 * A dashboard the agent has proposed but nobody has saved yet.
 *
 * Mirrors the `draft` returned by the `proposeDashboard` tool. `dashboardId` is
 * present only when revising a dashboard that already exists, in which case
 * saving updates that one rather than creating a second.
 */
export interface DashboardDraft {
  dashboardId?: string;
  title: string;
  globalControls?: DashboardInterface["globalControls"];
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
}

export interface DroppedBlock {
  title: string;
  type: string;
  reason: string;
}

/**
 * Pull the draft out of a `proposeDashboard` tool result.
 *
 * Reads defensively: the result is JSON that came back through the model's tool
 * loop, and a malformed one should render nothing rather than throw inside the
 * message list.
 */
export function dashboardDraftFromToolResult(result: unknown): {
  draft: DashboardDraft;
  droppedBlocks: DroppedBlock[];
} | null {
  const parsed =
    typeof result === "string"
      ? (() => {
          try {
            return JSON.parse(result) as unknown;
          } catch {
            return null;
          }
        })()
      : result;

  if (!parsed || typeof parsed !== "object") return null;
  const { draft, droppedBlocks } = parsed as {
    draft?: unknown;
    droppedBlocks?: unknown;
  };
  if (!draft || typeof draft !== "object") return null;

  const { title, blocks, globalControls, dashboardId } = draft as {
    title?: unknown;
    blocks?: unknown;
    globalControls?: unknown;
    dashboardId?: unknown;
  };
  if (typeof title !== "string" || !Array.isArray(blocks) || !blocks.length) {
    return null;
  }

  return {
    draft: {
      title,
      blocks:
        blocks as DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
      ...(globalControls
        ? {
            globalControls:
              globalControls as DashboardInterface["globalControls"],
          }
        : {}),
      ...(typeof dashboardId === "string" ? { dashboardId } : {}),
    },
    droppedBlocks: Array.isArray(droppedBlocks)
      ? (droppedBlocks as DroppedBlock[])
      : [],
  };
}

interface Props {
  draft: DashboardDraft;
  droppedBlocks?: DroppedBlock[];
  toolTransparency?: React.ReactNode;
}

export default function DashboardPreviewBubble({
  draft,
  droppedBlocks = [],
  toolTransparency,
}: Props) {
  const { apiCall } = useAuth();
  const { userId } = useUser();
  const { project, mutateDefinitions } = useDefinitions();

  // Everything the user can change here without going back to the agent. Blocks
  // are in state because the grid writes layout back; their *contents* are not
  // editable, which is why nothing below hands DashboardEditor a `setBlock`.
  const [title, setTitle] = useState(draft.title);
  const [blocks, setBlocks] = useState(draft.blocks);
  const [globalControls, setGlobalControls] = useState(
    draft.globalControls ?? DEFAULT_DASHBOARD_GLOBAL_CONTROLS,
  );
  const [shareLevel, setShareLevel] = useState<"private" | "published">(
    "private",
  );
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isRevision = !!draft.dashboardId;

  // A stand-in dashboard so the real renderer can draw an unsaved one. The "new"
  // id is load-bearing: DashboardSnapshotProvider skips its snapshot fetch for
  // it, and exploration tiles fetch their own analysis by id regardless.
  const previewDashboard = useMemo<DashboardInterface>(
    () => ({
      id: draft.dashboardId ?? "new",
      uid: draft.dashboardId ?? "new",
      organization: "",
      experimentId: undefined,
      isDefault: false,
      isDeleted: false,
      userId: userId || "",
      editLevel: "published",
      shareLevel,
      enableAutoUpdates: false,
      title,
      blocks: blocks as DashboardInterface["blocks"],
      globalControls,
      projects: project ? [project] : [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
    }),
    [
      draft.dashboardId,
      userId,
      shareLevel,
      title,
      blocks,
      globalControls,
      project,
    ],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiCall<{
        status: number;
        dashboard: DashboardInterface;
      }>(isRevision ? `/dashboards/${draft.dashboardId}` : "/dashboards", {
        method: isRevision ? "PUT" : "POST",
        body: JSON.stringify({
          title,
          blocks,
          globalControls,
          shareLevel,
          editLevel: "published",
          enableAutoUpdates: false,
          ...(isRevision
            ? {}
            : {
                experimentId: "",
                projects: project ? [project] : [],
                userId,
              }),
        }),
      });
      setSavedId(res.dashboard.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the dashboard");
    } finally {
      setSaving(false);
    }
  }, [
    apiCall,
    isRevision,
    draft.dashboardId,
    title,
    blocks,
    globalControls,
    shareLevel,
    project,
    userId,
  ]);

  return (
    <Box className={styles.wrapper}>
      <Flex align="center" justify="between" gap="3" mb="3" wrap="wrap">
        <Flex align="center" gap="2" flexGrow="1" minWidth="240px">
          <PiSparkleFill className={styles.icon} />
          {savedId ? (
            <Text size="md" weight="medium">
              {title}
            </Text>
          ) : (
            <Field
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Dashboard name"
              containerClassName={styles.titleField}
              aria-label="Dashboard name"
            />
          )}
        </Flex>

        {savedId ? (
          <Flex align="center" gap="3">
            <Flex align="center" gap="1">
              <PiCheckCircleFill className={styles.saved} />
              <Text size="sm">Saved</Text>
            </Flex>
            <Link href={`/product-analytics/dashboards/${savedId}`}>
              Open dashboard
            </Link>
          </Flex>
        ) : (
          <Flex align="center" gap="2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setShareLevel((s) =>
                  s === "private" ? "published" : "private",
                )
              }
            >
              {shareLevel === "private"
                ? "Private to you"
                : "Visible to organization"}
            </Button>
            <Button
              size="sm"
              loading={saving}
              onClick={save}
              disabled={!title.trim()}
            >
              {isRevision ? "Save changes" : "Save dashboard"}
            </Button>
          </Flex>
        )}
      </Flex>

      {droppedBlocks.length > 0 && (
        <Box mb="3">
          <Callout status="warning" size="sm">
            {droppedBlocks.length === 1
              ? `"${droppedBlocks[0].title}" was left off — ${droppedBlocks[0].reason}.`
              : `${droppedBlocks.length} tiles were left off because their queries could not be started.`}
          </Callout>
        </Box>
      )}

      {error && (
        <Box mb="3">
          <Callout status="error" size="sm">
            {error}
          </Callout>
        </Box>
      )}

      <DashboardSnapshotProvider
        dashboard={previewDashboard}
        mutateDefinitions={mutateDefinitions}
      >
        <DashboardEditor
          isTabActive
          id={previewDashboard.id}
          title={title}
          blocks={blocks}
          // Read-only contents, arrangeable layout: the user drags tiles here
          // and changes what's on them by asking the agent.
          isEditing={false}
          allowLayoutEditing={!savedId}
          setBlock={undefined}
          projects={previewDashboard.projects ?? []}
          enableAutoUpdates={false}
          updateSchedule={undefined}
          globalControls={globalControls}
          onGlobalControlsChange={async (next) => {
            // Clearing the filter bar comes back as undefined; fall back to the
            // defaults so the controls stay rendered rather than disappearing.
            setGlobalControls(next ?? DEFAULT_DASHBOARD_GLOBAL_CONTROLS);
          }}
          ownerId={previewDashboard.userId}
          dashboardOwnerId={previewDashboard.userId}
          initialEditLevel="published"
          initialShareLevel={shareLevel}
          nextUpdate={undefined}
          isGeneralDashboard
          mutate={() => {}}
          editBlockProps={{
            scrollAreaRef: null,
            editSidebarDirty: false,
            focusedBlockIndex: undefined,
            stagedBlockIndex: undefined,
            isAddingBlock: false,
            addBlockType: () => {},
            editBlock: () => {},
            duplicateBlock: () => {},
            deleteBlock: () => {},
            updateLayout: (layout) => {
              setBlocks((prev) =>
                prev.map((block, i) => {
                  // Match on the same key the grid renders with. A proposed
                  // block has no id yet, so this is a synthetic per-index key —
                  // guessing at `block.id` here would silently drop every drag.
                  const next = layout.find(
                    (l) => l.i === getGridKeyForBlock(block, i),
                  );
                  return next
                    ? {
                        ...block,
                        layout: {
                          x: next.x,
                          y: next.y,
                          w: next.w,
                          h: next.h,
                        },
                      }
                    : block;
                }),
              );
            },
          }}
        />
      </DashboardSnapshotProvider>

      {toolTransparency}
    </Box>
  );
}
