import { useContext, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import {
  canAutoRefreshDashboard,
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  getDashboardFilterApplicability,
} from "shared/enterprise";
import Button from "@/ui/Button";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DashboardSnapshotContext } from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import { DateRangePicker } from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DateRangePicker";

const DEFAULT_DASHBOARD_DATE_RANGE: NonNullable<
  NonNullable<DashboardInterface["filters"]>["dateRange"]
> = {
  predefined: "last30Days",
  lookbackValue: null,
  lookbackUnit: null,
  startDate: null,
  endDate: null,
};

interface Props {
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  filters: DashboardInterface["filters"];
  canEdit: boolean;
  isEditing: boolean;
  onFiltersChange: (filters: DashboardInterface["filters"]) => Promise<void>;
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

  const persistFilters = async (nextFilters: DashboardInterface["filters"]) => {
    if (saving) return;

    setSaving(true);
    await onFiltersChange(nextFilters);

    if (applicability.optedInBlocks.length === 0) {
      setNeedsUpdate(false);
    } else if (canAutoRefreshDashboard({ blocks }, datasourceMap)) {
      setNeedsUpdate(false);
      await updateAllSnapshots();
    } else {
      setNeedsUpdate(true);
    }

    setSaving(false);
  };

  return (
    <Flex align="center" gap="3" mt="2" justify="end">
      {hasDateFilter && filters?.dateRange && canModifyFilters ? (
        <DateRangePicker
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
        <DateRangePicker
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
