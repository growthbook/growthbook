import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import { isEqual } from "lodash";
import {
  blockUsesDashboardDateControl,
  buildComparisonDateRange,
  getEffectiveExplorationConfig,
  restoreBlockLocalDateControls,
} from "shared/enterprise";
import {
  ExplorationDateRange,
  ProductAnalyticsExploration,
} from "shared/validators";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import useApi from "@/hooks/useApi";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import {
  ExplorerProvider,
  useExplorerContext,
} from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { ExplorerContent } from "@/enterprise/components/ProductAnalytics/Explorer";
import {
  DashboardSqlBlockEditSession,
  getDashboardSqlBlockEditChannelName,
  readDashboardSqlBlockEditSession,
  removeDashboardSqlBlockEditSession,
} from "@/enterprise/components/Dashboards/dashboardSqlBlockEditSession";
import { ExplorerDraftConfig } from "@/enterprise/components/ProductAnalytics/util";

function getQueryParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function SqlBlockEditorActions({
  onExit,
  onUpdateRequested,
}: {
  onExit: () => void;
  onUpdateRequested: (requested: boolean) => void;
}) {
  const { draftExploreState, handleSubmit, isSubmittable, loading } =
    useExplorerContext();
  const [updating, setUpdating] = useState(false);
  const initialDraftRef = useRef(draftExploreState);
  const hasChanges = !isEqual(initialDraftRef.current, draftExploreState);

  return (
    <>
      <Button variant="ghost" color="red" onClick={onExit} disabled={updating}>
        Exit without saving
      </Button>
      <Button
        loading={updating}
        disabled={!hasChanges || !isSubmittable || loading}
        onClick={async () => {
          setUpdating(true);
          onUpdateRequested(true);
          try {
            await handleSubmit({ force: true });
          } finally {
            onUpdateRequested(false);
            setUpdating(false);
          }
        }}
      >
        Update Dashboard Block
      </Button>
    </>
  );
}

function SqlBlockEditor({
  session,
}: {
  session: DashboardSqlBlockEditSession;
}) {
  const { block, dashboardGlobalControls, sessionId } = session;
  const updateRequestedRef = useRef(false);
  const { data, error } = useApi<{
    status: number;
    exploration: ProductAnalyticsExploration;
  }>(`/product-analytics/exploration/${block.explorerAnalysisId}`, {
    shouldRun: () => Boolean(block.explorerAnalysisId),
  });
  const { data: comparisonData, error: comparisonError } = useApi<{
    status: number;
    exploration: ProductAnalyticsExploration;
  }>(
    `/product-analytics/exploration/${block.comparisonExplorerAnalysisId ?? ""}`,
    {
      shouldRun: () => Boolean(block.comparisonExplorerAnalysisId),
    },
  );

  if (
    (block.explorerAnalysisId && !data && !error) ||
    (block.comparisonExplorerAnalysisId && !comparisonData && !comparisonError)
  ) {
    return <LoadingOverlay />;
  }

  if (error || comparisonError) {
    return (
      <Callout status="error">
        Failed to load the existing dashboard block analysis.
      </Callout>
    );
  }

  const existingExploration = data?.exploration ?? null;
  const comparisonExploration = comparisonData?.exploration ?? null;
  const baseInitialConfig = existingExploration?.config
    ? { ...existingExploration.config, ...block.config }
    : block.config;
  const initialConfig =
    dashboardGlobalControls && blockUsesDashboardDateControl(block)
      ? getEffectiveExplorationConfig(block, {
          globalControls: dashboardGlobalControls,
        })
      : baseInitialConfig;
  const initialDraftConfig: ExplorerDraftConfig = block.comparison?.enabled
    ? {
        ...initialConfig,
        previousTimeFrame:
          block.comparison.previousTimeFrame ??
          buildComparisonDateRange(initialConfig.dateRange),
      }
    : initialConfig;
  const initialSubmittedConfig: ExplorerDraftConfig | undefined =
    existingExploration
      ? block.comparison?.enabled
        ? {
            ...existingExploration.config,
            previousTimeFrame:
              block.comparison.previousTimeFrame ??
              buildComparisonDateRange(existingExploration.config.dateRange),
          }
        : existingExploration.config
      : undefined;

  const sendMessage = (
    message:
      | {
          type: "update";
          sessionId: string;
          block: typeof block;
        }
      | { type: "exit"; sessionId: string },
  ) => {
    const channel = new BroadcastChannel(
      getDashboardSqlBlockEditChannelName(sessionId),
    );
    channel.postMessage(message);
    removeDashboardSqlBlockEditSession(sessionId);
    window.setTimeout(() => {
      channel.close();
      window.close();
    }, 0);
  };

  return (
    <ExplorerProvider
      initialConfig={initialDraftConfig}
      initialSubmittedConfig={initialSubmittedConfig}
      initialExploration={existingExploration}
      initialComparisonExploration={comparisonExploration}
      hasExistingResults={Boolean(existingExploration)}
      trackingSource="dashboard-editor"
      onRunComplete={(
        exploration,
        nextComparisonExploration,
        previousTimeFrame: ExplorationDateRange | null,
      ) => {
        if (!updateRequestedRef.current) return;
        if (exploration.config.type !== "sql") return;
        updateRequestedRef.current = false;
        const config =
          dashboardGlobalControls && blockUsesDashboardDateControl(block)
            ? restoreBlockLocalDateControls(exploration.config, block.config)
            : exploration.config;
        const comparison =
          previousTimeFrame !== null
            ? {
                enabled: true,
                ...(exploration.config.dateRange.predefined ===
                  "customDateRange" && { previousTimeFrame }),
              }
            : undefined;
        sendMessage({
          type: "update",
          sessionId,
          block: {
            ...block,
            config,
            explorerAnalysisId: exploration.id,
            comparison,
            comparisonExplorerAnalysisId: comparison
              ? nextComparisonExploration?.id
              : undefined,
          },
        });
      }}
    >
      <ExplorerContent
        hideDataSourceSelector
        sidebarHeaderActions={
          <SqlBlockEditorActions
            onExit={() => sendMessage({ type: "exit", sessionId })}
            onUpdateRequested={(requested) => {
              updateRequestedRef.current = requested;
            }}
          />
        }
      />
    </ExplorerProvider>
  );
}

export default function SqlBlockExplorePage() {
  const router = useRouter();
  const sessionId = getQueryParam(router.query.session);
  const [session, setSession] = useState<
    DashboardSqlBlockEditSession | null | undefined
  >(undefined);

  useEffect(() => {
    if (!router.isReady || !sessionId) return;
    setSession(readDashboardSqlBlockEditSession(sessionId));
  }, [router.isReady, sessionId]);

  if (!router.isReady || session === undefined) {
    return <LoadingOverlay />;
  }

  return (
    <Box className="position-relative" style={{ padding: "8px" }}>
      <PageHead
        breadcrumb={[
          {
            display: "Explore",
            href: "/product-analytics/explore",
          },
          {
            display: "SQL Dashboard Block",
          },
        ]}
      />
      {session ? (
        <SqlBlockEditor session={session} />
      ) : (
        <Flex justify="center" pt="6">
          <Callout status="error">
            This dashboard block editing session is no longer available. Return
            to the dashboard and open the SQL Explorer again.
          </Callout>
        </Flex>
      )}
    </Box>
  );
}
