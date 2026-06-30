import { useContext, useMemo, useRef, useState } from "react";
import { Flex } from "@radix-ui/themes";
import {
  canAutoRefreshDashboard,
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  getDashboardFilterApplicability,
  isDashboardFilterSupportedBlock,
} from "shared/enterprise";
import Button from "@/ui/Button";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DashboardSnapshotContext } from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import { ControlledDateRangePicker } from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DateRangePicker";

type DashboardDateRange = NonNullable<
  NonNullable<DashboardInterface["filters"]>["dateRange"]
>;

const DEFAULT_DASHBOARD_DATE_RANGE: DashboardDateRange = {
  predefined: "last30Days",
  lookbackValue: null,
  lookbackUnit: null,
  startDate: null,
  endDate: null,
};

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
  filters: DashboardInterface["filters"];
  canEdit: boolean;
  isEditing: boolean;
  onFiltersChange: (
    filters: DashboardInterface["filters"],
    blocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
  ) => Promise<void>;
  setNeedsUpdate: (needsUpdate: boolean) => void;
}

export default function DashboardFilterBar({
  blocks,
  filters,
  canEdit,
  isEditing,
  onFiltersChange,
  setNeedsUpdate,
}: Props) {
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const queuedFiltersRef = useRef<{
    filters: DashboardInterface["filters"];
  } | null>(null);
  const { datasources } = useDefinitions();
  const { updateAllSnapshots } = useContext(DashboardSnapshotContext);

  const applicability = useMemo(
    () => getDashboardFilterApplicability({ blocks }),
    [blocks],
  );
  const datasourceMap = useMemo(
    () => new Map(datasources.map((datasource) => [datasource.id, datasource])),
    [datasources],
  );
  const hasDateFilter = Boolean(filters?.dateRange);
  const canModifyFilters = canEdit && isEditing;

  const persistFiltersNow = async (
    nextFilters: DashboardInterface["filters"],
  ) => {
    setSaving(true);
    savingRef.current = true;
    try {
      const shouldOptInSupportedBlocks = Boolean(
        !filters?.dateRange && nextFilters?.dateRange,
      );
      const nextBlocks = shouldOptInSupportedBlocks
        ? blocks.map((block) =>
            isDashboardFilterSupportedBlock(block)
              ? {
                  ...block,
                  useDashboardFilters: true,
                }
              : block,
          )
        : blocks;
      await onFiltersChange(nextFilters);

      const nextApplicability = shouldOptInSupportedBlocks
        ? getDashboardFilterApplicability({ blocks: nextBlocks })
        : applicability;
      const nextDatasourceMap = datasourceMap;

      if (
        !nextFilters?.dateRange ||
        !hasCompleteDateRange(nextFilters.dateRange) ||
        nextApplicability.optedInBlocks.length === 0
      ) {
        setNeedsUpdate(false);
      } else if (
        canAutoRefreshDashboard({ blocks: nextBlocks }, nextDatasourceMap)
      ) {
        setNeedsUpdate(false);
        await updateAllSnapshots();
      } else {
        setNeedsUpdate(true);
      }
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  const persistFilters = async (nextFilters: DashboardInterface["filters"]) => {
    if (savingRef.current) {
      queuedFiltersRef.current = { filters: nextFilters };
      return;
    }

    await persistFiltersNow(nextFilters);

    while (queuedFiltersRef.current) {
      const { filters: queuedFilters } = queuedFiltersRef.current;
      queuedFiltersRef.current = null;
      await persistFiltersNow(queuedFilters);
    }
  };

  return (
    <Flex align="center" gap="3" mt="2" justify="end">
      {hasDateFilter && filters?.dateRange && canModifyFilters ? (
        <ControlledDateRangePicker
          value={filters.dateRange}
          onChange={(dateRange) =>
            persistFilters({
              ...(filters ?? {}),
              dateRange,
            })
          }
          shouldWrap
        />
      ) : hasDateFilter && filters?.dateRange ? (
        <ControlledDateRangePicker
          value={filters.dateRange}
          onChange={() => {}}
          shouldWrap
          disabled
        />
      ) : (
        <Button
          size="xs"
          variant="outline"
          disabled={!canModifyFilters || saving}
          onClick={() =>
            persistFilters({
              ...(filters ?? {}),
              dateRange: DEFAULT_DASHBOARD_DATE_RANGE,
            })
          }
        >
          Add date filter
        </Button>
      )}

      {hasDateFilter && canModifyFilters ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={saving}
          onClick={() => persistFilters({})}
        >
          Clear
        </Button>
      ) : null}
    </Flex>
  );
}
