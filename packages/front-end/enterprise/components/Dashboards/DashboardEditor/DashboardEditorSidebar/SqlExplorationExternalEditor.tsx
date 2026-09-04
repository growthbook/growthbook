import { ReactNode, useEffect, useRef, useState } from "react";
import { isEqual } from "lodash";
import {
  blockUsesDashboardDateControl,
  buildComparisonDateRange,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  getEffectiveExplorationConfig,
  restoreBlockLocalDateControls,
  SqlExplorationBlockInterface,
} from "shared/enterprise";
import {
  ExplorationConfig,
  ExplorationDateRange,
  ProductAnalyticsExploration,
} from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Modal from "@/ui/Modal";
import Text from "@/ui/Text";
import LoadingOverlay from "@/components/LoadingOverlay";
import PylonChatVisibility from "@/components/Auth/PylonChatVisibility";
import Tooltip from "@/components/Tooltip/Tooltip";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  ExplorerProvider,
  useExplorerContext,
} from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { ExplorerContent } from "@/enterprise/components/ProductAnalytics/Explorer";
import { useSqlEditorContext } from "@/enterprise/components/ProductAnalytics/SqlEditorContext";
import {
  cleanConfigForSubmission,
  ExplorerDraftConfig,
} from "@/enterprise/components/ProductAnalytics/util";

function SqlExplorationEditorModal({
  close,
  actions,
  children,
}: {
  close: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Modal.Root
      open
      size="fill"
      dismissible={false}
      hasDescription={false}
      trackingEventModalType="dashboard-sql-exploration-editor"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <Flex direction="column" height="100%">
        <Box flexGrow="1" minHeight="0" position="relative">
          {children}
        </Box>
        <Flex
          flexShrink="0"
          justify="end"
          align="center"
          gap="3"
          px="5"
          py="3"
          style={{ borderTop: "1px solid var(--gray-a5)" }}
        >
          <Modal.Close>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          </Modal.Close>
          {actions}
        </Flex>
      </Flex>
    </Modal.Root>
  );
}

function SqlExplorationModalContent({
  close,
  onUpdateRequested,
}: {
  close: () => void;
  onUpdateRequested: (requested: boolean, config?: ExplorationConfig) => void;
}) {
  const { draftExploreState, error, handleSubmit, isSubmittable, loading } =
    useExplorerContext();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();
  const { isQueryRunning, localSql } = useSqlEditorContext();
  const datasource = getDatasourceById(draftExploreState.datasource);
  const canRunQueries = datasource
    ? permissionsUtil.canRunSqlExplorerQueries(datasource)
    : false;
  const initialDraftRef = useRef(draftExploreState);
  const [updating, setUpdating] = useState(false);
  const hasChanges = !isEqual(initialDraftRef.current, draftExploreState);
  const hasUnpreviewedSqlChanges =
    draftExploreState.dataset.type === "sql" &&
    draftExploreState.dataset.sql !== localSql;

  useEffect(() => {
    if (!loading && error) {
      onUpdateRequested(false);
      setUpdating(false);
    }
  }, [error, loading, onUpdateRequested]);

  return (
    <SqlExplorationEditorModal
      close={close}
      actions={
        <Button
          loading={updating}
          disabled={
            !hasChanges ||
            hasUnpreviewedSqlChanges ||
            !isSubmittable ||
            !canRunQueries ||
            loading ||
            isQueryRunning
          }
          onClick={async () => {
            setUpdating(true);
            onUpdateRequested(
              true,
              cleanConfigForSubmission(draftExploreState),
            );
            try {
              await handleSubmit({ force: true });
            } catch (error) {
              onUpdateRequested(false);
              throw error;
            } finally {
              setUpdating(false);
            }
          }}
        >
          Update Block
        </Button>
      }
    >
      <ExplorerContent
        height="100%"
        hideDataSourceSelector
        hideSidebarHeaderActions
      />
    </SqlExplorationEditorModal>
  );
}

function SqlExplorationModal({
  block,
  dashboardGlobalControls,
  onUpdate,
  close,
}: {
  block: DashboardBlockInterfaceOrData<SqlExplorationBlockInterface>;
  dashboardGlobalControls?: DashboardInterface["globalControls"];
  onUpdate: (
    block: DashboardBlockInterfaceOrData<SqlExplorationBlockInterface>,
  ) => void;
  close: () => void;
}) {
  const updateRequestedRef = useRef(false);
  const submittedConfigRef = useRef<ExplorationConfig | null>(null);
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
    return (
      <SqlExplorationEditorModal close={close}>
        <LoadingOverlay />
      </SqlExplorationEditorModal>
    );
  }

  if (error || comparisonError) {
    return (
      <SqlExplorationEditorModal close={close}>
        <Box p="5">
          <Callout status="error">
            Failed to load the existing dashboard block analysis.
          </Callout>
        </Box>
      </SqlExplorationEditorModal>
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
        if (submittedConfigRef.current?.type !== "sql") return;

        updateRequestedRef.current = false;
        const submittedConfig = submittedConfigRef.current;
        submittedConfigRef.current = null;
        const config =
          dashboardGlobalControls && blockUsesDashboardDateControl(block)
            ? restoreBlockLocalDateControls(submittedConfig, block.config)
            : submittedConfig;
        const comparison =
          previousTimeFrame !== null
            ? {
                enabled: true,
                ...(submittedConfig.dateRange.predefined ===
                  "customDateRange" && { previousTimeFrame }),
              }
            : undefined;

        onUpdate({
          ...block,
          config,
          explorerAnalysisId: exploration.id,
          comparison,
          comparisonExplorerAnalysisId: comparison
            ? nextComparisonExploration?.id
            : undefined,
        });
        close();
      }}
    >
      <SqlExplorationModalContent
        close={close}
        onUpdateRequested={(requested, config) => {
          updateRequestedRef.current = requested;
          submittedConfigRef.current = config ?? null;
        }}
      />
    </ExplorerProvider>
  );
}

export default function SqlExplorationExternalEditor({
  block,
  dashboardGlobalControls,
  onUpdate,
  emptyState = false,
}: {
  block: DashboardBlockInterfaceOrData<SqlExplorationBlockInterface>;
  dashboardGlobalControls?: DashboardInterface["globalControls"];
  onUpdate: (
    block: DashboardBlockInterfaceOrData<SqlExplorationBlockInterface>,
  ) => void;
  emptyState?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(block.config.datasource);
  const canRunQueries = datasource
    ? permissionsUtil.canRunSqlExplorerQueries(datasource)
    : false;
  const permissionMessage =
    "You do not have permission to run SQL explorer queries for this Data Source.";

  return (
    <>
      <PylonChatVisibility hidden={open} />
      {emptyState ? (
        <Flex
          direction="column"
          align="center"
          gap="3"
          p="5"
          width="100%"
          style={{
            border: "2px dashed var(--gray-a4)",
            borderRadius: "var(--radius-4)",
          }}
        >
          <Text align="center" color="text-mid">
            Build a visualization from a custom SQL query
          </Text>
          <Tooltip body={permissionMessage} shouldDisplay={!canRunQueries}>
            <Button disabled={!canRunQueries} onClick={() => setOpen(true)}>
              Write or generate query
            </Button>
          </Tooltip>
        </Flex>
      ) : (
        <Button
          size="sm"
          variant="outline"
          color="violet"
          onClick={() => setOpen(true)}
        >
          {canRunQueries ? "Edit Query" : "View Query"}
        </Button>
      )}
      {open ? (
        <SqlExplorationModal
          block={block}
          dashboardGlobalControls={dashboardGlobalControls}
          onUpdate={onUpdate}
          close={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
