import React, { useMemo } from "react";
import { omit } from "lodash";
import { Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { ApiPopulation, MetricValue } from "shared/validators";
import {
  getMetricIdentifierTypes,
  getMetricPopulationViolations,
} from "shared/enterprise";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import MetricName from "@/components/Metrics/MetricName";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
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
  getPopulationFactTableId,
  getReadOnlyUnit,
  getUnitConflict,
  getUnitPicker,
  setMetricValuesUnit,
} from "@/enterprise/components/ProductAnalytics/metricMixing";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useUser } from "@/services/UserContext";
import { usePopulations } from "@/hooks/usePopulations";
import ShowAsInput from "./ShowAsInput";
import ValueCard from "./ValueCard";
import styles from "./ValueCard.module.scss";

// Radix Select items can't use an empty string, so "no Population" needs a key.
const NO_POPULATION = "__none__";

export default function MetricTabContent() {
  const {
    draftExploreState,
    setDraftExploreState,
    addValueToDataset,
    updateValueInDataset,
  } = useExplorerContext();
  const {
    factMetrics,
    factTables,
    getFactTableById,
    getFactMetricById,
    project,
  } = useDefinitions();
  const { permissionsUtil } = useUser();
  const { populations } = usePopulations(project);

  const values: MetricValue[] =
    draftExploreState.dataset?.type === "metric"
      ? draftExploreState.dataset.values
      : [];
  const population =
    draftExploreState.dataset?.type === "metric"
      ? draftExploreState.dataset.population
      : undefined;
  const hasPopulation = population !== undefined;
  const unitState = getMetricValuesUnitState(
    values,
    getFactMetricById,
    getFactTableById,
  );
  const unitPicker = getUnitPicker(values, unitState, getFactMetricById);
  const addMetricConflict = getAddMetricConflict(
    values.map((v) => getFactMetricById(v.metricId ?? "")?.metricType),
  );

  // Only offer Populations that read from the metrics' shared Fact Table.
  const populationFactTableId = getPopulationFactTableId(
    values,
    getFactMetricById,
  );
  const populationCanBeCombined = (candidate: ApiPopulation) => {
    const isOnThisDataSource =
      candidate.datasource === draftExploreState.datasource;
    const readsFromMetricsFactTable =
      candidate.steps[0]?.source.factTableId === populationFactTableId;
    const supportsChartUnit =
      !unitPicker?.value || candidate.userIdTypes.includes(unitPicker.value);
    return isOnThisDataSource && readsFromMetricsFactTable && supportsChartUnit;
  };
  const populationOptions = populations.filter(populationCanBeCombined);
  // Keep the picker visible while a Population is set so it can be cleared.
  const showPopulationPicker = populationFactTableId !== null || hasPopulation;
  const savedPopulation = population
    ? (populations.find((p) => p.id === population.populationId) ?? null)
    : null;

  const getPopulationViolations = (): string[] => {
    if (!population) return [];
    const metricMap = new Map<string, FactMetricInterface>();
    const chosenValues: MetricValue[] = [];
    for (const value of values) {
      if (!value.metricId) continue;
      chosenValues.push(value);
      const metric = getFactMetricById(value.metricId);
      if (metric) metricMap.set(metric.id, metric);
    }
    return getMetricPopulationViolations({
      population,
      savedPopulation,
      values: chosenValues,
      dimensions: draftExploreState.dimensions,
      datasource: draftExploreState.datasource,
      metricMap,
      factTableMap: new Map(factTables.map((table) => [table.id, table])),
    });
  };
  const populationViolations = getPopulationViolations();

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
    setDraftExploreState((prev) => {
      if (prev.type !== "metric") return prev;
      const nextValues = setMetricValuesUnit(
        prev.dataset.values,
        unit,
        getFactMetricById,
      );
      // The Population counts members by the chart's identifier type.
      const nextDataset = { ...prev.dataset, values: nextValues };
      if (prev.dataset.population) {
        nextDataset.population = { ...prev.dataset.population, unit };
      }
      return { ...prev, dataset: nextDataset };
    });

  const handlePopulationChange = (populationId: string) =>
    setDraftExploreState((prev) => {
      if (prev.type !== "metric") return prev;
      if (populationId === NO_POPULATION) {
        return { ...prev, dataset: omit(prev.dataset, "population") };
      }

      const unit = unitPicker?.value;
      if (!unit) return prev;

      // Populations can only be grouped by date.
      const dateDimensions = prev.dimensions.filter(
        (d) => d.dimensionType === "date",
      );
      return {
        ...prev,
        dimensions: dateDimensions,
        dataset: {
          ...prev.dataset,
          population: { populationId, unit },
        },
      };
    });

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
          hasPopulation,
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
          {showPopulationPicker && (
            <Select
              label="Population"
              labelWeight="medium"
              value={population?.populationId ?? NO_POPULATION}
              disabled={!unitPicker.value}
              error={
                unitPicker.value
                  ? undefined
                  : "Select an identifier type to add a Population."
              }
              errorLevel="warning"
              setValue={handlePopulationChange}
            >
              <SelectItem value={NO_POPULATION}>None</SelectItem>
              {populationOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </Select>
          )}
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
          {populationViolations.length > 0 && (
            <Callout status="warning">
              {populationViolations.map((violation) => (
                <div key={violation}>{violation}</div>
              ))}
            </Callout>
          )}
        </Flex>
      )}
    </Flex>
  );
}
