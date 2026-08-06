import { useContext, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiSlidersHorizontal } from "react-icons/pi";
import {
  canAutoRefreshDashboard,
  autoEnrollDashboardBlocksInDateControl,
  autoEnrollDashboardBlocksInGlobalFilter,
  DASHBOARD_GLOBAL_FILTER_KEYS,
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  getDashboardGlobalControlApplicability,
  getDashboardExperimentFilterApplicability,
  isEnablingGlobalFilter,
} from "shared/enterprise";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DashboardSnapshotContext } from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import DashboardDateControlsDropdown from "./DashboardDateControlsDropdown";
import DashboardFilterPills from "./DashboardFilterPills";
import DashboardAddFilterDropdown from "./DashboardAddFilterDropdown";
import DashboardExperimentSearchTermPill from "./DashboardExperimentSearchTermPill";
import {
  DASHBOARD_OPTIONAL_FILTERS,
  DashboardOptionalFilterKey,
  isOptionalFilterActive,
} from "./dashboardFilterCatalog";
import {
  getExperimentSearchTerm,
  setExperimentSearchTerm,
} from "./experimentSearchFilterString";

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

  // Which optional filters the blocks on this dashboard actually honor. A filter
  // no block supports can't be added — it would silently do nothing.
  const applicability = useMemo(() => {
    const experimentApplicability =
      getDashboardExperimentFilterApplicability(blocks);
    return {
      projects: experimentApplicability.showProjects,
      metricId: experimentApplicability.showMetric,
      experimentSearchString: experimentApplicability.showExperimentSearch,
    };
  }, [blocks]);

  // Filters the user added from the "Add filter" menu, plus any pill they have
  // edited. These stay in the bar for the session even with no value, so a pill
  // doesn't vanish out from under the user when they clear its last value.
  // Reloading the dashboard leaves only the filters that have a saved value.
  const [addedKeys, setAddedKeys] = useState<DashboardOptionalFilterKey[]>([]);
  const [lastAddedKey, setLastAddedKey] =
    useState<DashboardOptionalFilterKey | null>(null);

  const rememberKey = (key: DashboardOptionalFilterKey) =>
    setAddedKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));

  const forgetKey = (key: DashboardOptionalFilterKey) => {
    setAddedKeys((prev) => prev.filter((k) => k !== key));
    setLastAddedKey((prev) => (prev === key ? null : prev));
  };

  const visibleKeys = useMemo(
    () =>
      DASHBOARD_OPTIONAL_FILTERS.filter(
        (filter) =>
          applicability[filter.requires] &&
          (addedKeys.includes(filter.key) ||
            isOptionalFilterActive(globalControls, filter.key)),
      ).map((filter) => filter.key),
    [applicability, addedKeys, globalControls],
  );

  const experimentSearchTerm = getExperimentSearchTerm(
    globalControls?.experimentSearchString,
  );

  const canReset =
    addedKeys.length > 0 ||
    Boolean(globalControls?.dateRange) ||
    Boolean(globalControls?.metricId) ||
    Boolean(globalControls?.experimentSearchString) ||
    Array.isArray(globalControls?.projects);

  // Persist a change to one of the experiment-block filters (projects / metric /
  // experiment search). Unlike the date control, these never trigger a snapshot
  // refresh — the affected experiment blocks re-render client-side (or re-key
  // their own query) from the new global controls. We intentionally do NOT flip
  // `saving` here: the local state updates optimistically, and disabling the
  // controls on every checkbox toggle makes the pills flicker.
  const persistExperimentFilter = async (
    patch: Partial<NonNullable<DashboardInterface["globalControls"]>>,
  ) => {
    const nextGlobalControls: NonNullable<
      DashboardInterface["globalControls"]
    > = { ...(globalControls ?? {}), ...patch };
    // Normalize "empty" values back to absent so the filter reads as inactive.
    // Projects is the exception: an empty array explicitly means "All projects"
    // (an active override), so it's kept — only an absent value is inactive.
    if (!nextGlobalControls.projects) {
      delete nextGlobalControls.projects;
    }
    if (!nextGlobalControls.metricId) delete nextGlobalControls.metricId;
    if (!nextGlobalControls.experimentSearchString) {
      delete nextGlobalControls.experimentSearchString;
    }

    // Auto-enroll supported blocks the first time a filter is enabled.
    let nextBlocks = blocks;
    DASHBOARD_GLOBAL_FILTER_KEYS.forEach((key) => {
      if (isEnablingGlobalFilter(globalControls, nextGlobalControls, key)) {
        nextBlocks = autoEnrollDashboardBlocksInGlobalFilter(nextBlocks, key);
      }
    });
    const blocksChanged = nextBlocks !== blocks;
    await onGlobalControlsChange(
      nextGlobalControls,
      blocksChanged ? nextBlocks : undefined,
    );
  };

  const persistGlobalControls = async (
    nextGlobalControls: DashboardInterface["globalControls"],
    nextBlocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
  ) => {
    setSaving(true);
    try {
      const blocksForRefresh =
        nextBlocks ??
        (nextGlobalControls?.dateRange
          ? autoEnrollDashboardBlocksInDateControl(blocks)
          : blocks);
      await onGlobalControlsChange(
        nextGlobalControls,
        nextGlobalControls?.dateRange ? blocksForRefresh : nextBlocks,
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

  // Clear every filter at once and drop the session's added-but-empty pills.
  // Order matters: the pills are cleared only once the empty controls have been
  // persisted, so a stale render can't re-mark a filter as touched.
  const resetAll = async () => {
    await persistGlobalControls({});
    setAddedKeys([]);
    setLastAddedKey(null);
  };

  const controlsDisabled = !canModifyControls || saving;

  return (
    <Flex direction="column" gap="3" mt="3" p="3">
      <Flex align="center" gap="3" justify="between">
        <Flex align="center" gap="2" wrap="wrap">
          <Flex direction="row" align="center" gap="1" mr="1">
            <PiSlidersHorizontal
              size={16}
              style={{
                color: "var(--violet-11)",
              }}
            />
            <Heading as="h3" size="sm" weight="medium" mb="0">
              Filters
            </Heading>
          </Flex>
          <DashboardDateControlsDropdown
            value={globalControls?.dateRange ?? null}
            granularity={globalControls?.dateGranularity ?? "auto"}
            disabled={controlsDisabled}
            onChange={(dateRange) => {
              const nextGlobalControls = { ...(globalControls ?? {}) };
              if (dateRange) {
                nextGlobalControls.dateRange = dateRange;
                nextGlobalControls.dateGranularity ??= "auto";
              } else {
                delete nextGlobalControls.dateRange;
                delete nextGlobalControls.dateGranularity;
              }
              persistGlobalControls(nextGlobalControls);
            }}
            onGranularityChange={(granularity) => {
              if (!globalControls?.dateRange) return;
              persistGlobalControls({
                ...(globalControls ?? {}),
                dateGranularity: granularity,
              });
            }}
          />
          <DashboardFilterPills
            globalControls={globalControls}
            visibleKeys={visibleKeys}
            autoOpenKey={lastAddedKey}
            disabled={controlsDisabled}
            projects={projects ?? []}
            onChange={(key, patch) => {
              rememberKey(key);
              persistExperimentFilter(patch);
            }}
            onRemove={(key, patch) => {
              // Clearing the value alone would leave the pill in place (it stays
              // for the session once touched), so drop the key as well.
              forgetKey(key);
              persistExperimentFilter(patch);
            }}
          />
          {experimentSearchTerm ? (
            <DashboardExperimentSearchTermPill
              value={experimentSearchTerm}
              disabled={controlsDisabled}
              onChange={(searchTerm) =>
                persistExperimentFilter({
                  experimentSearchString:
                    setExperimentSearchTerm(
                      globalControls?.experimentSearchString,
                      searchTerm,
                    ) || undefined,
                })
              }
            />
          ) : null}
          <DashboardAddFilterDropdown
            visibleKeys={visibleKeys}
            applicability={applicability}
            disabled={controlsDisabled}
            onAdd={(key) => {
              rememberKey(key);
              setLastAddedKey(key);
            }}
          />
        </Flex>
        {canReset && canModifyControls ? (
          <Button size="md" variant="ghost" onClick={resetAll}>
            Reset all
          </Button>
        ) : null}
      </Flex>
    </Flex>
  );
}
