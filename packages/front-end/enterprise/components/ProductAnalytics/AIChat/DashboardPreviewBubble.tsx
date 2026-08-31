import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  blockUsesDashboardDateControl,
  DEFAULT_DASHBOARD_GLOBAL_CONTROLS,
  getEffectiveExplorationConfig,
  proposeDashboardResultValidator,
  resolveBlockComparison,
  resolveComparisonMode,
  resolveComparisonPreviousTimeFrame,
  type DashboardBlockInterface,
  type DashboardBlockInterfaceOrData,
  type DashboardDraftOf,
  type DashboardInterface,
  type DroppedDashboardBlock,
} from "shared/enterprise";
import { parseToolResult } from "shared/ai-chat";
import { PiCheckCircleFill, PiSparkle } from "react-icons/pi";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import { Select, SelectItem } from "@/ui/Select";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExploreData } from "@/enterprise/components/ProductAnalytics/useExploreData";
import DashboardSnapshotProvider from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import DashboardEditor, {
  getGridKeyForBlock,
} from "@/enterprise/components/Dashboards/DashboardEditor";
import styles from "./DashboardPreviewBubble.module.scss";

/** A proposed, unsaved dashboard. `dashboardId` set only when revising one. */
export type DashboardDraft = DashboardDraftOf<
  DashboardBlockInterfaceOrData<DashboardBlockInterface>
>;

/** Pull the draft out of a `proposeDashboard` tool result. */
export function dashboardDraftFromToolResult(result: unknown): {
  draft: DashboardDraft;
  droppedBlocks: DroppedDashboardBlock[];
} | null {
  const parsed = parseToolResult(result, proposeDashboardResultValidator);
  if (!parsed) return null;
  // The blocks came out of `proposeDashboardBlockValidator` on the way in, so
  // this narrows rather than trusts — see the note on `dashboardDraftValidator`.
  return {
    draft: parsed.draft as DashboardDraft,
    droppedBlocks: parsed.droppedBlocks,
  };
}

interface Props {
  draft: DashboardDraft;
  droppedBlocks?: DroppedDashboardBlock[];
  /** Dashboard this tile was already saved to, from a previous visit. */
  savedDashboardId?: string;
  /** Persist the binding so a re-opened conversation updates rather than duplicates. */
  onSaved?: (dashboardId: string) => void;
  toolTransparency?: React.ReactNode;
  /** Re-opened conversation: the stored analysis ids may have aged out, so re-query once. */
  refreshOnMount?: boolean;
}

export default function DashboardPreviewBubble({
  draft,
  droppedBlocks = [],
  savedDashboardId,
  onSaved,
  toolTransparency,
  refreshOnMount = false,
}: Props) {
  const { apiCall } = useAuth();
  const { userId, hasCommercialFeature } = useUser();
  const hasSharing = hasCommercialFeature("share-product-analytics-dashboards");
  const { project, mutateDefinitions } = useDefinitions();
  const { fetchData: fetchExplorationData } = useExploreData();

  // Blocks are in state because the grid writes layout back; contents are not
  // editable, hence no `setBlock` below.
  const [blocks, setBlocks] = useState(draft.blocks);
  const [globalControls, setGlobalControls] = useState(
    draft.globalControls ?? DEFAULT_DASHBOARD_GLOBAL_CONTROLS,
  );
  const [comparison, setComparison] = useState(draft.comparison);
  const [shareLevel, setShareLevel] = useState<"private" | "published">(
    "private",
  );
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(
    savedDashboardId ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  // Separate from `error`: a rehydrate that may still paint older tiles is
  // degraded, not blocked. Only a failed save stops the user outright.
  const [staleData, setStaleData] = useState<string | null>(null);

  const title = draft.title;
  // The dashboard this tile writes to: the one the agent is revising, or the
  // one a previous save created. Bound means update — never create a second.
  const boundDashboardId = savedId ?? draft.dashboardId ?? null;

  // The agent's answer wins; the app's selection only stands in when it had
  // none. An explicit `[]` means "every project", not "unset".
  const projects = useMemo(
    () => draft.projects ?? (project ? [project] : []),
    [draft.projects, project],
  );

  // Stand-in so the real renderer can draw an unsaved dashboard. The "new" id is
  // load-bearing: DashboardSnapshotProvider skips its snapshot fetch for it.
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
      projects,
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
      projects,
    ],
  );

  // Also what enables Update: it is disabled on an unsaved dashboard without this.
  const refreshBlocks = useCallback(
    async (
      controls: DashboardInterface["globalControls"] = globalControls,
      comparisonRef: DashboardInterface["comparison"] = comparison,
      // "never" so Update means Update. The mount refresh passes "preferred":
      // re-opening an old thread shouldn't put six queries on the warehouse.
      cache: "never" | "preferred" = "never",
    ) => {
      const next = await Promise.all(
        blocks.map(async (block) => {
          // Tiles that don't follow the dashboard date control have nothing to
          // re-run, and experimentation tiles compute client-side.
          if (!blockUsesDashboardDateControl(block)) return block;

          const config = getEffectiveExplorationConfig(block, {
            globalControls: controls,
          });
          // Dashboard-wide setting wins over the block's own, both ways.
          const blockComparison = resolveBlockComparison(block, {
            comparison: comparisonRef,
          });
          const result = await fetchExplorationData(config, {
            cache,
            previousTimeFrame: blockComparison
              ? resolveComparisonPreviousTimeFrame(
                  config.dateRange,
                  blockComparison,
                )
              : null,
            comparisonMode: blockComparison
              ? resolveComparisonMode(blockComparison)
              : null,
          });
          if (!result.data) {
            throw new Error(result.error ?? "Could not refresh this block");
          }
          return {
            ...block,
            explorerAnalysisId: result.data.id,
            comparisonExplorerAnalysisId:
              result.comparison?.exploration?.id ?? undefined,
          };
        }),
      );
      setBlocks(next);
      setJustSaved(false);
    },
    [blocks, globalControls, comparison, fetchExplorationData],
  );

  // Ref-guarded, not an empty dep list: `refreshBlocks` closes over `blocks` and
  // changes identity the moment it succeeds, which without the guard loops.
  const didRefreshOnMount = useRef(false);
  useEffect(() => {
    if (!refreshOnMount || didRefreshOnMount.current) return;
    didRefreshOnMount.current = true;
    void refreshBlocks(globalControls, comparison, "preferred").catch(() => {
      // The tiles keep rendering whatever their stored analysis ids still
      // resolve to, which may be nothing. Say so rather than leaving the user
      // to wonder why a tile is blank.
      setStaleData(
        "These tiles could not be refreshed, so they may be showing older results " +
          "or nothing at all. Change a filter and click Update to try again.",
      );
    });
  }, [refreshOnMount, refreshBlocks, globalControls, comparison]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiCall<{
        status: number;
        dashboard: DashboardInterface;
      }>(boundDashboardId ? `/dashboards/${boundDashboardId}` : "/dashboards", {
        method: boundDashboardId ? "PUT" : "POST",
        body: JSON.stringify({
          title,
          blocks,
          globalControls,
          // Explicit rather than omitted: an absent key reads as "leave alone".
          comparison: comparison ?? { enabled: false },
          // Access and auto-refresh are create-time choices here. Sending them on
          // an update would push this tile's defaults over what the dashboard
          // already has — turning off an auto-refresh the user had switched on.
          ...(boundDashboardId
            ? {}
            : {
                enableAutoUpdates: false,
                shareLevel,
                editLevel: "published",
                experimentId: "",
                projects,
                userId,
              }),
        }),
      });
      setSavedId(res.dashboard.id);
      setJustSaved(true);
      // Outlives this mount: without it a re-opened conversation offers Save
      // again on the same tile and creates a duplicate dashboard.
      onSaved?.(res.dashboard.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the dashboard");
    } finally {
      setSaving(false);
    }
  }, [
    apiCall,
    boundDashboardId,
    onSaved,
    title,
    blocks,
    globalControls,
    comparison,
    shareLevel,
    projects,
    userId,
  ]);

  return (
    <Box className={styles.wrapper}>
      <Flex align="center" justify="between" gap="3" mb="3" wrap="wrap">
        {/* No title field here: the dashboard renders its own title just below,
            and renaming is a prompt away. The header keeps naming the artifact
            after a save; the check on the right is the one confirmation. */}
        <Flex align="center" gap="2" flexGrow="1" minWidth="0">
          <PiSparkle className={styles.icon} />
          <Text size="md" weight="medium">
            Suggested dashboard
          </Text>
        </Flex>

        <Flex align="end" gap="2">
          {justSaved && (
            <Flex align="center" gap="1" pb="1">
              <PiCheckCircleFill className={styles.saved} />
              <Text size="sm">Saved</Text>
            </Flex>
          )}
          {boundDashboardId ? (
            <LinkButton
              href={`/product-analytics/dashboards/${boundDashboardId}`}
              variant="ghost"
              size="sm"
              color="violet"
            >
              Open dashboard
            </LinkButton>
          ) : (
            // Only on the create path: an existing dashboard keeps the access
            // it already has, changed from the dashboard's own share settings.
            <Select
              label="View access"
              labelSize="sm"
              size="sm"
              disabled={!hasSharing}
              value={shareLevel}
              setValue={(value) =>
                setShareLevel(value as "private" | "published")
              }
            >
              <SelectItem value="published">Organization members</SelectItem>
              <SelectItem value="private">Only me</SelectItem>
            </Select>
          )}
          <Button
            size="sm"
            loading={saving}
            onClick={save}
            disabled={!title.trim()}
          >
            {boundDashboardId ? "Update dashboard" : "Save dashboard"}
          </Button>
        </Flex>
      </Flex>

      {!boundDashboardId && !hasSharing && (
        <Box mb="3">
          <Callout status="warning" size="sm">
            Your organization&apos;s plan does not support sharing dashboards,
            so this one will be visible only to you.
          </Callout>
        </Box>
      )}

      {droppedBlocks.length > 0 && (
        <Box mb="3">
          <Callout status="warning" size="sm">
            {droppedBlocks.length === 1 ? (
              `"${droppedBlocks[0].title}" was left off — ${droppedBlocks[0].reason}.`
            ) : (
              // Per-tile reasons: three tiles lost to three different causes
              // read as one vague failure without them.
              <>
                {droppedBlocks.length} tiles were left off:
                <ul className={styles.droppedList}>
                  {droppedBlocks.map((block) => (
                    <li key={block.title}>
                      {`"${block.title}" — ${block.reason}.`}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Callout>
        </Box>
      )}

      {staleData && (
        <Box mb="3">
          <Callout status="warning" size="sm">
            {staleData}
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
          allowLayoutEditing
          setBlock={undefined}
          projects={previewDashboard.projects ?? []}
          enableAutoUpdates={false}
          updateSchedule={undefined}
          globalControls={globalControls}
          dashboardComparison={comparison}
          onDashboardComparisonChange={async (next) => {
            // `{ enabled: false }` rather than undefined so "off" is explicit
            // and survives the save body.
            setComparison(next ?? { enabled: false });
          }}
          onGlobalControlsChange={async (next) => {
            // Store only — the controls bar decides whether to re-query now or
            // mark tiles stale, so refreshing here too runs every query twice.
            setGlobalControls(next ?? DEFAULT_DASHBOARD_GLOBAL_CONTROLS);
          }}
          updateTemporaryDashboardResults={async (controls) =>
            refreshBlocks(controls ?? globalControls, comparison)
          }
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

      {toolTransparency ? (
        <Box mt="2" pt="2" style={{ borderTop: "1px solid var(--gray-a5)" }}>
          {toolTransparency}
        </Box>
      ) : null}
    </Box>
  );
}
