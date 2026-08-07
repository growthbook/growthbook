import { useContext, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiSlidersHorizontal } from "react-icons/pi";
import { isEqual } from "lodash";
import {
  canAutoRefreshDashboard,
  autoEnrollDashboardBlocksInDateControl,
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  getDashboardGlobalControlApplicability,
  isEnablingDashboardDateControl,
} from "shared/enterprise";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DashboardSnapshotContext } from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Heading from "@/ui/Heading";
import DashboardDateControlsDropdown from "./DashboardDateControlsDropdown";

type DashboardDateRange = NonNullable<
  NonNullable<DashboardInterface["globalControls"]>["dateRange"]
>;

function hasCompleteDateRange(dateRange: DashboardDateRange): boolean {
  if (dateRange.predefined === "customDateRange") {
    return Boolean(dateRange.startDate && dateRange.endDate);
  }
  if (dateRange.predefined === "customLookback") {
    return Boolean(dateRange.lookbackValue && dateRange.lookbackUnit);
  }
  return true;
}

interface Props {
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  globalControls: DashboardInterface["globalControls"];
  canEdit: boolean;
  onGlobalControlsChange: (
    globalControls: DashboardInterface["globalControls"],
    blocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
  ) => Promise<void>;
  dashboardComparison?: DashboardInterface["comparison"];
  onDashboardComparisonChange?: (
    comparison: DashboardInterface["comparison"],
  ) => Promise<void>;
  updateTemporaryDashboardResults?: (
    globalControls?: DashboardInterface["globalControls"],
    blocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
  ) => Promise<void>;
  setNeedsUpdate: (needsUpdate: boolean) => void;
}

export default function DashboardGlobalControlsBar({
  blocks,
  globalControls,
  canEdit,
  onGlobalControlsChange,
  dashboardComparison,
  onDashboardComparisonChange,
  updateTemporaryDashboardResults,
  setNeedsUpdate,
}: Props) {
  const [saving, setSaving] = useState(false);
  const { datasources } = useDefinitions();
  const { projects, savedQueriesMap, updateAllSnapshots } = useContext(
    DashboardSnapshotContext,
  );
  const { canCreateAnalyses, canRunSqlExplorerQueries } = usePermissionsUtil();
  const datasourceMap = useMemo(
    () => new Map(datasources.map((datasource) => [datasource.id, datasource])),
    [datasources],
  );
  const datasourceIds = useMemo(
    () => [...(savedQueriesMap?.values() ?? [])].map((sq) => sq.datasourceId),
    [savedQueriesMap],
  );
  const datasourcesInUse = datasourceIds.map((id) => datasourceMap.get(id));
  const canRunDashboardQueries =
    canCreateAnalyses(projects) &&
    !datasourcesInUse.some(
      (datasource) => datasource && !canRunSqlExplorerQueries(datasource),
    );
  const canModifyControls = canEdit && canRunDashboardQueries;

  const persistGlobalControls = async (
    nextGlobalControls: DashboardInterface["globalControls"],
    nextBlocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
  ) => {
    setSaving(true);
    try {
      // Only on first enable — re-enrolling on every date change would flip
      // blocks the user had opted out of back onto the dashboard filter.
      const enrolling = isEnablingDashboardDateControl(
        globalControls,
        nextGlobalControls,
      );
      const blocksForRefresh =
        nextBlocks ??
        (enrolling ? autoEnrollDashboardBlocksInDateControl(blocks) : blocks);
      await onGlobalControlsChange(
        nextGlobalControls,
        enrolling ? blocksForRefresh : nextBlocks,
      );
      const nextApplicability = getDashboardGlobalControlApplicability({
        blocks: blocksForRefresh,
        globalControls: nextGlobalControls,
      });
      const hasDateControl = Boolean(nextGlobalControls?.dateRange);
      const hasCompleteDateControl =
        !nextGlobalControls?.dateRange ||
        hasCompleteDateRange(nextGlobalControls.dateRange);
      const hasAffectedBlocks = Boolean(
        nextApplicability.dateControlledBlocks.length,
      );

      if (!hasDateControl || !hasCompleteDateControl || !hasAffectedBlocks) {
        setNeedsUpdate(false);
      } else if (
        canAutoRefreshDashboard(
          { blocks: blocksForRefresh, globalControls: nextGlobalControls },
          datasourceMap,
        )
      ) {
        if (updateTemporaryDashboardResults) {
          await updateTemporaryDashboardResults(
            nextGlobalControls,
            blocksForRefresh,
          );
        } else {
          await updateAllSnapshots();
        }
        setNeedsUpdate(false);
      } else {
        setNeedsUpdate(true);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flex direction="column" gap="3" mt="2">
      <Flex align="center" gap="3" justify="between">
        <Flex direction="row" align="center" gap="1">
          <PiSlidersHorizontal
            size={16}
            style={{
              color: "var(--violet-11)",
            }}
          />
          <Heading as="h3" size="sm" weight="medium">
            Dashboard Filters
          </Heading>
        </Flex>
        <DashboardDateControlsDropdown
          value={globalControls?.dateRange ?? null}
          granularity={globalControls?.dateGranularity ?? "auto"}
          disabled={!canModifyControls || saving}
          comparison={dashboardComparison ?? null}
          showCompare={!!onDashboardComparisonChange}
          // One write for range + granularity: separate persists each spread the
          // same `globalControls`, so the second dropped the first's range.
          onApply={async ({ dateRange, granularity, comparison }) => {
            const nextGlobalControls = { ...(globalControls ?? {}) };
            if (dateRange) {
              nextGlobalControls.dateRange = dateRange;
              nextGlobalControls.dateGranularity = granularity;
            } else {
              // "Chart Default": each block keeps its own range, so there is no
              // dashboard-wide series left for a granularity to bucket.
              delete nextGlobalControls.dateRange;
              delete nextGlobalControls.dateGranularity;
            }
            // Its own PUT, and it must land before persistGlobalControls —
            // that ends by refreshing every block.
            const comparisonChanged =
              !!onDashboardComparisonChange &&
              !isEqual(comparison ?? null, dashboardComparison ?? null);
            if (comparisonChanged) {
              await onDashboardComparisonChange?.(comparison);
            }
            await persistGlobalControls(nextGlobalControls);
            // Nothing was refreshed without a dashboard-wide range.
            if (comparisonChanged && !nextGlobalControls.dateRange) {
              setNeedsUpdate(true);
            }
          }}
        />
      </Flex>
    </Flex>
  );
}
