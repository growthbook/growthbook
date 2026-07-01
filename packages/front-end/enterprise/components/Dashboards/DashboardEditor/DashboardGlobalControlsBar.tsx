import { useContext, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { format } from "date-fns";
import { getValidDateOffsetByUTC } from "shared/dates";
import {
  canAutoRefreshDashboard,
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardGlobalDimension,
  DashboardInterface,
  getDashboardGlobalControlApplicability,
  isDashboardGlobalControlSupportedBlock,
} from "shared/enterprise";
import { dateRangePredefined, lookbackUnit } from "shared/validators";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import SelectField from "@/components/Forms/SelectField";
import { Select, SelectItem } from "@/ui/Select";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DashboardSnapshotContext } from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import {
  DashboardGlobalControlCandidate,
  getDashboardGlobalControlCandidates,
} from "./dashboardGlobalControlCandidates";

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

function createGlobalDimension(
  candidate: DashboardGlobalControlCandidate,
): DashboardGlobalDimension {
  return {
    id: `gd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label: candidate.label,
    column: candidate.column,
    maxValues: 5,
    targets: candidate.targets.map((target) => ({
      blockId: target.blockId,
      column: target.column,
      valueIndex: target.valueIndex,
      datasource: target.datasource,
      datatype: target.datatype,
      ...(target.factTableId ? { factTableId: target.factTableId } : {}),
      ...(target.metricId ? { metricId: target.metricId } : {}),
    })),
  };
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
            value={value.lookbackValue?.toString() ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                lookbackValue: e.target.value
                  ? parseInt(e.target.value, 10)
                  : null,
                lookbackUnit: value.lookbackUnit || "day",
              })
            }
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
  const [selectedCandidateKey, setSelectedCandidateKey] = useState("");
  const [saving, setSaving] = useState(false);
  const { datasources, getFactTableById, getFactMetricById } = useDefinitions();
  const { updateAllSnapshots } = useContext(DashboardSnapshotContext);
  const canModifyControls = canEdit && isEditing;
  const candidates = useMemo(
    () =>
      getDashboardGlobalControlCandidates({
        blocks,
        getFactTableById,
        getFactMetricById,
      }),
    [blocks, getFactTableById, getFactMetricById],
  );
  const datasourceMap = useMemo(
    () => new Map(datasources.map((datasource) => [datasource.id, datasource])),
    [datasources],
  );
  const applicability = useMemo(
    () => getDashboardGlobalControlApplicability({ blocks, globalControls }),
    [blocks, globalControls],
  );
  const dimensions = globalControls?.dimensions ?? [];

  const persistGlobalControls = async (
    nextGlobalControls: DashboardInterface["globalControls"],
    nextBlocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
  ) => {
    setSaving(true);
    try {
      await onGlobalControlsChange(nextGlobalControls, nextBlocks);
      const blocksForRefresh = nextBlocks ?? blocks;
      const hasDateControl = Boolean(nextGlobalControls?.dateRange);
      const hasCompleteDateControl =
        !nextGlobalControls?.dateRange ||
        hasCompleteDateRange(nextGlobalControls.dateRange);
      const hasGroupBys = (nextGlobalControls?.dimensions ?? []).length > 0;

      if ((!hasDateControl && !hasGroupBys) || !hasCompleteDateControl) {
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

  const addDimension = () => {
    const candidate = candidates.find((c) => c.key === selectedCandidateKey);
    if (!candidate) return;
    persistGlobalControls({
      ...(globalControls ?? {}),
      dimensions: [...dimensions, createGlobalDimension(candidate)],
    });
    setSelectedCandidateKey("");
  };

  const updateDimension = (
    dimensionId: string,
    updates: Partial<DashboardGlobalDimension>,
  ) => {
    persistGlobalControls({
      ...(globalControls ?? {}),
      dimensions: dimensions.map((dimension) =>
        dimension.id === dimensionId ? { ...dimension, ...updates } : dimension,
      ),
    });
  };

  const removeDimension = (dimensionId: string) => {
    persistGlobalControls({
      ...(globalControls ?? {}),
      dimensions: dimensions.filter(
        (dimension) => dimension.id !== dimensionId,
      ),
    });
  };

  const selectedCandidate = candidates.find(
    (candidate) => candidate.key === selectedCandidateKey,
  );

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

      {(canModifyControls || dimensions.length > 0) && (
        <Box
          p="3"
          style={{
            border: "1px solid var(--gray-a3)",
            borderRadius: "var(--radius-3)",
            backgroundColor: "var(--color-panel-translucent)",
          }}
        >
          <Flex direction="column" gap="3">
            <Flex align="center" justify="between" gap="3" wrap="wrap">
              <Text size="medium" weight="medium">
                Group by
              </Text>
              {canModifyControls ? (
                <Flex align="end" gap="2" wrap="wrap">
                  <SelectField
                    label="Add group by"
                    value={selectedCandidateKey}
                    placeholder="Choose dimension..."
                    options={candidates.map((candidate) => ({
                      label: `${candidate.label} (${candidate.targets.length} target${candidate.targets.length === 1 ? "" : "s"})`,
                      value: candidate.key,
                    }))}
                    onChange={setSelectedCandidateKey}
                    isClearable
                    disabled={saving || candidates.length === 0}
                  />
                  <Button
                    size="sm"
                    disabled={!selectedCandidate || saving}
                    onClick={addDimension}
                  >
                    Add
                  </Button>
                </Flex>
              ) : null}
            </Flex>

            {dimensions.length === 0 ? (
              <Text size="medium" color="text-low">
                No dashboard group-bys yet.
              </Text>
            ) : (
              dimensions.map((dimension) => {
                const impact = applicability.dimensions.find(
                  ({ dimension: d }) => d.id === dimension.id,
                );
                return (
                  <Flex
                    key={dimension.id}
                    direction="column"
                    gap="2"
                    p="3"
                    style={{
                      border: "1px solid var(--gray-a3)",
                      borderRadius: "var(--radius-3)",
                    }}
                  >
                    <Flex align="center" justify="between" gap="3" wrap="wrap">
                      <Flex align="center" gap="2" wrap="wrap">
                        <Text weight="medium">{dimension.label}</Text>
                        <Badge
                          label={`Applies to ${impact?.affectedBlocks.length ?? 0} block${impact?.affectedBlocks.length === 1 ? "" : "s"}`}
                          variant="soft"
                          color="violet"
                        />
                        {impact?.invalidTargets.length ? (
                          <Badge
                            label={`${impact.invalidTargets.length} unavailable target${impact.invalidTargets.length === 1 ? "" : "s"}`}
                            variant="outline"
                            color="amber"
                          />
                        ) : null}
                      </Flex>
                      {canModifyControls ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={saving}
                          onClick={() => removeDimension(dimension.id)}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </Flex>
                    {canModifyControls ? (
                      <Flex gap="3" wrap="wrap" align="end">
                        <Field
                          label="Max values"
                          type="number"
                          min="1"
                          max="20"
                          value={dimension.maxValues.toString()}
                          disabled={saving}
                          onChange={(e) => {
                            const parsed = parseInt(e.target.value, 10);
                            if (
                              !Number.isNaN(parsed) &&
                              parsed >= 1 &&
                              parsed <= 20
                            ) {
                              updateDimension(dimension.id, {
                                maxValues: parsed,
                              });
                            }
                          }}
                        />
                      </Flex>
                    ) : null}
                  </Flex>
                );
              })
            )}
          </Flex>
        </Box>
      )}
    </Flex>
  );
}
