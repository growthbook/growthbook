import React, { useMemo } from "react";
import { omit } from "lodash";
import { Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { MetricValue } from "shared/validators";
import { getMetricIdentifierTypes } from "shared/enterprise";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import MetricName from "@/components/Metrics/MetricName";
import Button from "@/ui/Button";
import { Select, SelectItem } from "@/ui/Select";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  generateUniqueValueName,
  getShowAsChoice,
  MetricMixClass,
} from "@/enterprise/components/ProductAnalytics/util";
import {
  getAddMetricConflict,
  getLockedMixClass,
  getMetricValuesUnitState,
  getMixClassConflict,
  getReadOnlyUnit,
  getUnitConflict,
  getUnitPicker,
  setMetricValuesUnit,
} from "@/enterprise/components/ProductAnalytics/metricMixing";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useUser } from "@/services/UserContext";
import ShowAsInput from "./ShowAsInput";
import ValueCard from "./ValueCard";
import styles from "./ValueCard.module.scss";

export default function MetricTabContent() {
  const {
    draftExploreState,
    setDraftExploreState,
    addValueToDataset,
    updateValueInDataset,
  } = useExplorerContext();
  const { factMetrics, getFactTableById, getFactMetricById, project } =
    useDefinitions();
  const { permissionsUtil } = useUser();

  const values: MetricValue[] =
    draftExploreState.dataset?.type === "metric"
      ? draftExploreState.dataset.values
      : [];
  const unitState = getMetricValuesUnitState(
    values,
    getFactMetricById,
    getFactTableById,
  );
  const unitPicker = getUnitPicker(values, unitState, getFactMetricById);
  const addMetricConflict = getAddMetricConflict(
    values.map((v) => getFactMetricById(v.metricId ?? "")?.metricType),
  );

  // Build the base grouped options list for this datasource. All metrics are
  // always shown; compat is enforced per-slot via isOptionDisabled so users
  // get a visual hint + tooltip instead of a silently shorter list.
  const groupedOptions = useMemo(() => {
    const grouped: GroupedValue[] = [];
    const managedMetrics: SingleValue[] = [];
    const unManagedMetrics: SingleValue[] = [];
    factMetrics.forEach((m) => {
      if (m.datasource !== draftExploreState.datasource) return;
      // The Explorer can't chart funnel or compound metrics yet.
      if (m.metricType === "funnel" || m.metricType === "compound") return;
      if (m.managedBy) {
        managedMetrics.push({ label: m.name, value: m.id });
      } else {
        unManagedMetrics.push({ label: m.name, value: m.id });
      }
    });
    if (managedMetrics.length > 0) {
      grouped.push({ label: "Official Metrics", options: managedMetrics });
    }
    if (unManagedMetrics.length > 0) {
      grouped.push({ label: "", options: unManagedMetrics });
    }
    return grouped.length > 1
      ? grouped
      : grouped.length === 1
        ? grouped[0].options
        : [];
  }, [factMetrics, draftExploreState.datasource]);

  /** The class any metric in `slotIdx` must match to be compatible with the
   *  rest of the chart (or null if no restriction applies). */
  const getLockedClassForSlot = (
    slotIdx: number,
  ): Exclude<MetricMixClass, "unknown"> | null => {
    const otherTypes = values
      .filter((_, i) => i !== slotIdx)
      .map((v) => getFactMetricById(v.metricId ?? "")?.metricType);
    return getLockedMixClass(otherTypes);
  };

  /** The unit a metric in `slotIdx` must offer to keep the chart on one unit
   *  (or null when the other metrics have none, or already mix units). */
  const getLockedUnitForSlot = (slotIdx: number): string | null => {
    const others = getMetricValuesUnitState(
      values.filter((_, i) => i !== slotIdx),
      getFactMetricById,
      getFactTableById,
    );
    return others.isMixed ? null : others.unit;
  };

  /** Why `metric` can't go in a slot with these locks, or null if it can. */
  const getDisabledReason = (
    metric: FactMetricInterface,
    lockedClass: Exclude<MetricMixClass, "unknown"> | null,
    lockedUnit: string | null,
  ): string | null =>
    getMixClassConflict(metric.metricType, lockedClass) ??
    getUnitConflict(metric, lockedUnit, getFactTableById);

  const handleUnitChange = (unit: string) =>
    setDraftExploreState((prev) =>
      prev.type === "metric"
        ? {
            ...prev,
            dataset: {
              ...prev.dataset,
              values: setMetricValuesUnit(
                prev.dataset.values,
                unit,
                getFactMetricById,
              ),
            },
          }
        : prev,
    );

  return (
    <Flex direction="column" gap="4">
      {!values.length && (
        <Text size="sm" color="text-low">
          Add at least one metric to chart
        </Text>
      )}

      {values.map((v, idx) => {
        const lockedClass = getLockedClassForSlot(idx);
        const lockedUnit = getLockedUnitForSlot(idx);
        const disabledReasonFor = (metricId: string) => {
          const metric = getFactMetricById(metricId);
          return metric
            ? getDisabledReason(metric, lockedClass, lockedUnit)
            : null;
        };
        const { options: showAsOptions, showAs } = getShowAsChoice(
          v,
          draftExploreState.showAs,
          getFactMetricById,
        );
        return (
          <ValueCard
            key={idx}
            index={idx}
            readOnlyUnit={getReadOnlyUnit(
              v,
              unitState.isMixed,
              getFactMetricById,
            )}
            filterActions={
              showAsOptions.length > 0 && (
                <ShowAsInput
                  options={showAsOptions}
                  value={showAs}
                  setValue={(next) =>
                    updateValueInDataset(idx, { ...v, showAs: next })
                  }
                  unit={v.unit}
                  metricName={v.name.trim() || `Metric ${idx + 1}`}
                />
              )
            }
          >
            <Flex direction="column">
              <SelectField
                size="legacy"
                className={styles.metricSelect}
                value={v.metricId}
                disabled={
                  !permissionsUtil.canRunMetricQueries({
                    projects: [project],
                  }) && !permissionsUtil.canRunMetricQueries({ projects: [] })
                }
                onChange={(val) => {
                  const newMetric = getFactMetricById(val);
                  // Keep the chart's unit (or this slot's, when it's the only
                  // metric) if the new metric offers it; otherwise
                  // fillMissingUnits picks one.
                  const unit = lockedUnit ?? v.unit;
                  const newIdentifierTypes = newMetric
                    ? getMetricIdentifierTypes(newMetric, getFactTableById)
                    : [];
                  // A new metric starts from its own inferred showAs.
                  const updates = {
                    ...omit(v, "showAs"),
                    metricId: val,
                    unit:
                      unit && newIdentifierTypes.includes(unit) ? unit : null,
                    name: newMetric?.name
                      ? generateUniqueValueName(
                          newMetric.name,
                          // Tab content only renders for "metric" datasets.
                          draftExploreState.dataset.type === "metric"
                            ? draftExploreState.dataset.values
                            : [],
                        )
                      : v.name,
                  } as MetricValue;

                  updateValueInDataset(idx, updates as MetricValue);
                }}
                options={groupedOptions}
                isOptionDisabled={(option) =>
                  "value" in option && disabledReasonFor(option.value) !== null
                }
                formatOptionLabel={({ value }, meta) => {
                  const metric = getFactMetricById(value);
                  if (!metric) return value;
                  // Only attach the restriction tooltip inside the open menu
                  // (not in the selected-value display) so it doesn't fire on
                  // every hover over the selected option.
                  const disabledReason =
                    meta.context === "menu" ? disabledReasonFor(value) : null;
                  if (!disabledReason) return <MetricName metric={metric} />;
                  // Badge tooltip off: one tooltip per option.
                  return (
                    <Tooltip content={disabledReason}>
                      <span>
                        <MetricName metric={metric} disableTooltip />
                      </span>
                    </Tooltip>
                  );
                }}
                formatGroupLabel={({ label }) => {
                  return label;
                }}
                sort={false}
                placeholder="Select metric..."
                forceUndefinedValueToNull
              />
            </Flex>
          </ValueCard>
        );
      })}
      <Tooltip
        enabled={addMetricConflict !== null}
        content={addMetricConflict ?? ""}
      >
        <Button
          size="md"
          variant="outline"
          disabled={addMetricConflict !== null}
          onClick={() => addValueToDataset("metric")}
        >
          <Flex align="center" gap="2">
            <PiPlus size={14} />
            Add metric
          </Flex>
        </Button>
      </Tooltip>
      {unitPicker && (
        <Flex
          direction="column"
          gap="2"
          p="3"
          style={{
            border: "1px solid var(--gray-a3)",
            borderRadius: "var(--radius-4)",
            backgroundColor: "var(--color-panel-translucent)",
          }}
        >
          <Select
            label="Identifier type"
            labelWeight="medium"
            value={unitPicker.value ?? undefined}
            placeholder={unitPicker.placeholder}
            disabled={unitPicker.disabledReason !== null}
            error={unitPicker.disabledReason ?? undefined}
            errorLevel="warning"
            setValue={handleUnitChange}
          >
            {unitPicker.options.map((unit) => (
              <SelectItem key={unit} value={unit}>
                {unit}
              </SelectItem>
            ))}
          </Select>
        </Flex>
      )}
    </Flex>
  );
}
