import React, { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import type { MetricValue } from "shared/validators";
import { getFactMetricPrimaryFactTableId } from "shared/experiments";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import MetricName from "@/components/Metrics/MetricName";
import Button from "@/ui/Button";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  generateUniqueValueName,
  getLockedMixClass,
  getMetricMixClass,
  MetricMixClass,
} from "@/enterprise/components/ProductAnalytics/util";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import { usePopulations } from "@/hooks/usePopulations";
import { Select, SelectItem } from "@/ui/Select";
import ValueCard from "./ValueCard";
import styles from "./ValueCard.module.scss";

export default function MetricTabContent() {
  const { draftExploreState, addValueToDataset, updateValueInDataset } =
    useExplorerContext();
  const { factMetrics, getFactTableById, getFactMetricById, project } =
    useDefinitions();
  const { permissionsUtil } = useUser();
  const {
    populations,
    loading: populationsLoading,
    error: populationsError,
  } = usePopulations(project);

  const values: MetricValue[] =
    draftExploreState.dataset?.type === "metric"
      ? draftExploreState.dataset.values
      : [];

  // Build the base grouped options list for this datasource. All metrics are
  // always shown; compat is enforced per-slot via isOptionDisabled so users
  // get a visual hint + tooltip instead of a silently shorter list.
  const groupedOptions = useMemo(() => {
    const grouped: GroupedValue[] = [];
    const managedMetrics: SingleValue[] = [];
    const unManagedMetrics: SingleValue[] = [];
    factMetrics.forEach((m) => {
      if (m.datasource !== draftExploreState.datasource) return;
      // The Explorer can't chart funnel metrics yet.
      if (m.metricType === "funnel") return;
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

  const mixTooltip = (locked: Exclude<MetricMixClass, "unknown">) =>
    locked === "ratio"
      ? "Ratio metrics can't be combined with other metric types."
      : locked === "quantile"
        ? "Quantile metrics can't be combined with other metric types."
        : "Only the same metric type can be combined in one chart.";

  return (
    <Flex direction="column" gap="4">
      {!values.length && (
        <Text size="sm" color="text-low">
          Add at least one metric to chart
        </Text>
      )}

      {values.map((v, idx) => {
        const metric = getFactMetricById(v.metricId);
        const compatiblePopulations = populations.filter(
          (p) =>
            p.datasource === draftExploreState.datasource &&
            p.steps.length === 1 &&
            !p.steps[0].windowSettings.type &&
            p.steps[0].source.factTableId === metric?.numerator?.factTableId &&
            !!v.unit &&
            p.userIdTypes.includes(v.unit) &&
            permissionsUtil.canRunMetricQueries(p),
        );
        const hasBreakdown = draftExploreState.dimensions.some(
          (d) => d.dimensionType !== "date",
        );
        const unavailablePopulation =
          !populationsLoading &&
          !populationsError &&
          !!v.populationId &&
          !compatiblePopulations.some((p) => p.id === v.populationId);
        const lockedClass = getLockedClassForSlot(idx);
        const disabledTooltip = lockedClass ? mixTooltip(lockedClass) : "";
        return (
          <ValueCard key={idx} index={idx}>
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
                  const newMetric = factMetrics.find((m) => m.id === val);
                  const newFactTable = newMetric
                    ? getFactTableById(
                        getFactMetricPrimaryFactTableId(newMetric),
                      )
                    : null;

                  let unit = v.unit;
                  if (!unit || !newFactTable?.userIdTypes.includes(unit)) {
                    unit = newFactTable?.userIdTypes[0] ?? null;
                  }

                  const updates = {
                    ...v,
                    metricId: val,
                    populationId: null,
                    populationVersion: undefined,
                    unit,
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
                isOptionDisabled={(option) => {
                  if (!lockedClass || !("value" in option)) return false;
                  const metric = factMetrics.find((m) => m.id === option.value);
                  if (!metric) return false;
                  return getMetricMixClass(metric.metricType) !== lockedClass;
                }}
                formatOptionLabel={({ value }, meta) => {
                  const metric = factMetrics.find((m) => m.id === value);
                  const label = metric ? <MetricName metric={metric} /> : value;
                  // Only attach the mix-restriction tooltip inside the open
                  // menu (not in the selected-value display) so it doesn't
                  // fire on every hover over the selected option.
                  const isDisabledInMenu =
                    meta.context === "menu" &&
                    !!lockedClass &&
                    !!metric &&
                    getMetricMixClass(metric.metricType) !== lockedClass;
                  if (isDisabledInMenu) {
                    return (
                      <Tooltip body={disabledTooltip} usePortal>
                        <span>{label}</span>
                      </Tooltip>
                    );
                  }
                  return label;
                }}
                formatGroupLabel={({ label }) => {
                  return label;
                }}
                sort={false}
                placeholder="Select metric..."
                forceUndefinedValueToNull
              />
              {(metric?.metricType === "proportion" || v.populationId) && (
                <>
                  <Select
                    mt="3"
                    label="Population"
                    value={v.populationId || "none"}
                    disabled={
                      populationsLoading || (hasBreakdown && !v.populationId)
                    }
                    error={
                      populationsError
                        ? "Unable to load populations"
                        : unavailablePopulation
                          ? "This population is unavailable or incompatible with the selected metric and unit."
                          : undefined
                    }
                    setValue={(id) =>
                      updateValueInDataset(idx, {
                        ...v,
                        populationId: id === "none" ? null : id,
                        populationVersion: undefined,
                      })
                    }
                  >
                    <SelectItem value="none">None (show total)</SelectItem>
                    {unavailablePopulation && (
                      <SelectItem value={v.populationId!} disabled>
                        Unavailable population
                      </SelectItem>
                    )}
                    {compatiblePopulations.map((p) => (
                      <SelectItem
                        key={p.id}
                        value={p.id}
                        disabled={hasBreakdown}
                      >
                        {p.name}
                      </SelectItem>
                    ))}
                  </Select>
                  <Text size="sm" color="text-low">
                    {hasBreakdown
                      ? "Remove non-date breakdowns to select a population."
                      : v.populationId
                        ? "Shows the share of population members who qualify for this metric. Membership is evaluated within each date bucket."
                        : "Select a population to show a conversion rate instead of a total."}
                  </Text>
                </>
              )}
            </Flex>
          </ValueCard>
        );
      })}
      <Button
        size="md"
        variant="outline"
        onClick={() => addValueToDataset("metric")}
      >
        <Flex align="center" gap="2">
          <PiPlus size={14} />
          Add metric
        </Flex>
      </Button>
    </Flex>
  );
}
