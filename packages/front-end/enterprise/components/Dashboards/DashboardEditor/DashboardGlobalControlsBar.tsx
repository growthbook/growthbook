import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import { getValidDateOffsetByUTC } from "shared/dates";
import {
  canAutoRefreshDashboard,
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  getDashboardGlobalControlApplicability,
  isDashboardGlobalControlSupportedBlock,
} from "shared/enterprise";
import { dateRangePredefined, lookbackUnit } from "shared/validators";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import { Select, SelectItem } from "@/ui/Select";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DashboardSnapshotContext } from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";

type DashboardDateRange = NonNullable<
  NonNullable<DashboardInterface["globalControls"]>["dateRange"]
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

function DashboardDateRangePicker({
  value,
  onChange,
  disabled,
}: {
  value: DashboardDateRange;
  onChange: (dateRange: DashboardDateRange) => void;
  disabled?: boolean;
}) {
  const [localLookbackValue, setLocalLookbackValue] = useState<string | null>(
    null,
  );
  const latestLookbackRef = useRef<string>("");
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    if (value.predefined !== "customLookback") {
      setLocalLookbackValue(null);
      latestLookbackRef.current = "";
    }
  }, [value.predefined]);

  const commitLookbackValue = (lookbackValue: string) => {
    const parsed = lookbackValue ? parseInt(lookbackValue, 10) : null;
    const isValid = parsed !== null && parsed >= 1 && !Number.isNaN(parsed);

    if (!isValid) {
      setLocalLookbackValue(null);
      latestLookbackRef.current = "";
      return;
    }

    onChange({
      ...value,
      lookbackValue: parsed,
      lookbackUnit: value.lookbackUnit || "day",
    });
    setLocalLookbackValue(null);
    latestLookbackRef.current = "";
  };

  return (
    <Flex align="center" gap="2" wrap="wrap">
      <Select
        size="2"
        value={value.predefined}
        disabled={disabled}
        setValue={(predefined) => {
          const nextPredefined =
            predefined as (typeof dateRangePredefined)[number];
          onChange({
            ...value,
            predefined: nextPredefined,
            ...(nextPredefined === "customLookback"
              ? {
                  lookbackValue: value.lookbackValue || 30,
                  lookbackUnit: value.lookbackUnit || "day",
                }
              : {}),
            ...(nextPredefined === "customDateRange"
              ? {
                  startDate:
                    value.startDate ?? format(new Date(), "yyyy-MM-dd"),
                  endDate: value.endDate ?? format(new Date(), "yyyy-MM-dd"),
                }
              : {}),
          });
        }}
      >
        <SelectItem value="today">Today</SelectItem>
        <SelectItem value="last7Days">Past 7 Days</SelectItem>
        <SelectItem value="last30Days">Past 30 Days</SelectItem>
        <SelectItem value="last90Days">Past 90 Days</SelectItem>
        <SelectItem value="customLookback">Custom Lookback</SelectItem>
        <SelectItem value="customDateRange">Custom Date Range</SelectItem>
      </Select>
      {value.predefined === "customLookback" ? (
        <>
          <Field
            type="number"
            min="1"
            disabled={disabled}
            style={{ width: 70 }}
            value={
              localLookbackValue !== null
                ? localLookbackValue
                : value.lookbackValue?.toString() || ""
            }
            onFocus={() => {
              latestLookbackRef.current = value.lookbackValue?.toString() || "";
            }}
            onChange={(e) => {
              const nextValue = e.target.value;
              latestLookbackRef.current = nextValue;
              setLocalLookbackValue(nextValue);
            }}
            onBlur={() => {
              if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false;
                return;
              }
              commitLookbackValue(latestLookbackRef.current);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const nextValue =
                  latestLookbackRef.current ||
                  value.lookbackValue?.toString() ||
                  "";
                commitLookbackValue(nextValue);
                skipBlurCommitRef.current = true;
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <Select
            size="2"
            value={value.lookbackUnit || "day"}
            disabled={disabled}
            setValue={(unit) =>
              onChange({
                ...value,
                lookbackUnit: unit as (typeof lookbackUnit)[number],
              })
            }
          >
            <SelectItem value="hour">hours</SelectItem>
            <SelectItem value="day">days</SelectItem>
            <SelectItem value="week">weeks</SelectItem>
            <SelectItem value="month">months</SelectItem>
          </Select>
        </>
      ) : null}
      {value.predefined === "customDateRange" ? (
        <Box style={{ minWidth: 240 }}>
          <DatePicker
            containerClassName="mb-0"
            compact
            date={
              value.startDate
                ? getValidDateOffsetByUTC(value.startDate)
                : undefined
            }
            date2={
              value.endDate ? getValidDateOffsetByUTC(value.endDate) : undefined
            }
            setDate={(date) =>
              onChange({
                ...value,
                startDate: date ? format(date, "yyyy-MM-dd") : null,
              })
            }
            setDate2={(date) =>
              onChange({
                ...value,
                endDate: date ? format(date, "yyyy-MM-dd") : null,
              })
            }
            precision="date"
          />
        </Box>
      ) : null}
    </Flex>
  );
}

interface Props {
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  globalControls: DashboardInterface["globalControls"];
  canEdit: boolean;
  isEditing: boolean;
  onGlobalControlsChange: (
    globalControls: DashboardInterface["globalControls"],
    blocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
  ) => Promise<void>;
  setNeedsUpdate: (needsUpdate: boolean) => void;
}

export default function DashboardGlobalControlsBar({
  blocks,
  globalControls,
  canEdit,
  isEditing,
  onGlobalControlsChange,
  setNeedsUpdate,
}: Props) {
  const [saving, setSaving] = useState(false);
  const { datasources } = useDefinitions();
  const { updateAllSnapshots } = useContext(DashboardSnapshotContext);
  const canModifyControls = canEdit && isEditing;
  const datasourceMap = useMemo(
    () => new Map(datasources.map((datasource) => [datasource.id, datasource])),
    [datasources],
  );

  const persistGlobalControls = async (
    nextGlobalControls: DashboardInterface["globalControls"],
    nextBlocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
  ) => {
    setSaving(true);
    try {
      await onGlobalControlsChange(nextGlobalControls, nextBlocks);
      const blocksForRefresh = nextBlocks ?? blocks;
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
        setNeedsUpdate(false);
        await updateAllSnapshots();
      } else {
        setNeedsUpdate(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const addDateControl = () => {
    const nextBlocks = blocks.map((block) =>
      isDashboardGlobalControlSupportedBlock(block)
        ? {
            ...block,
            globalControlSettings: {
              ...block.globalControlSettings,
              dateRange: true,
            },
          }
        : block,
    );
    persistGlobalControls(
      {
        ...(globalControls ?? {}),
        dateRange: DEFAULT_DASHBOARD_DATE_RANGE,
      },
      nextBlocks,
    );
  };

  return (
    <Flex direction="column" gap="3" mt="2">
      <Flex align="center" gap="3" wrap="wrap" justify="end">
        {globalControls?.dateRange ? (
          <>
            <Text size="medium" weight="medium">
              Date range
            </Text>
            <DashboardDateRangePicker
              value={globalControls.dateRange}
              disabled={!canModifyControls || saving}
              onChange={(dateRange) =>
                persistGlobalControls({
                  ...(globalControls ?? {}),
                  dateRange,
                })
              }
            />
            {canModifyControls ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={saving}
                onClick={() =>
                  persistGlobalControls({
                    ...(globalControls ?? {}),
                    dateRange: undefined,
                  })
                }
              >
                Clear date
              </Button>
            ) : null}
          </>
        ) : (
          <Button
            size="xs"
            variant="outline"
            disabled={!canModifyControls || saving}
            onClick={addDateControl}
          >
            Add date control
          </Button>
        )}
      </Flex>
    </Flex>
  );
}
