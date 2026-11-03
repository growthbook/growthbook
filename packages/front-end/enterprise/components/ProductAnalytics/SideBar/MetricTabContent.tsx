import React, { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowSquareOut, PiPlus } from "react-icons/pi";
import type { MetricValue } from "shared/validators";
import type { FactMetricInterface } from "shared/types/fact-table";
import { getFactMetricPrimaryFactTableId } from "shared/experiments";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import MetricName from "@/components/Metrics/MetricName";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  generateUniqueValueName,
  getLockedMixClass,
  getMetricMixClass,
  getMetricPopulationConflict,
  countsEveryPopulationMember,
  getEffectiveShowAs,
  MetricMixClass,
} from "@/enterprise/components/ProductAnalytics/util";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import ValueCard from "./ValueCard";
import PopulationSection from "./PopulationSection";
import styles from "./ValueCard.module.scss";

export default function MetricTabContent() {
  const { draftExploreState, addValueToDataset, updateValueInDataset } =
    useExplorerContext();
  const { factMetrics, getFactTableById, getFactMetricById, project } =
    useDefinitions();
  const { permissionsUtil } = useUser();

  const values: MetricValue[] =
    draftExploreState.dataset?.type === "metric"
      ? draftExploreState.dataset.values
      : [];
  const population =
    draftExploreState.dataset?.type === "metric"
      ? (draftExploreState.dataset.population ?? null)
      : null;

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

  /** Why a metric can't go in a slot locked to `lockedClass`, or null. */
  const getDisabledReason = (
    metric: FactMetricInterface,
    lockedClass: Exclude<MetricMixClass, "unknown"> | null,
  ): string | null => {
    if (population) {
      const conflict = getMetricPopulationConflict(
        metric,
        population.source.factTableId,
      );
      if (conflict === "metricType") {
        return "Populations only work with Proportion metrics.";
      }
      if (conflict === "factTable") {
        return "This metric uses a different Fact Table than the Population.";
      }
    }
    if (lockedClass && getMetricMixClass(metric.metricType) !== lockedClass) {
      return mixTooltip(lockedClass);
    }
    return null;
  };

  return (
    <Flex direction="column" gap="4">
      <PopulationSection />
      {!values.length && (
        <Text size="sm" color="text-low">
          Add at least one metric to chart
        </Text>
      )}

      {values.map((v, idx) => {
        const lockedClass = getLockedClassForSlot(idx);
        const selectedMetric = getFactMetricById(v.metricId ?? "");
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
                  if (population) {
                    unit = population.unit;
                  } else if (
                    !unit ||
                    !newFactTable?.userIdTypes.includes(unit)
                  ) {
                    unit = newFactTable?.userIdTypes[0] ?? null;
                  }

                  const updates = {
                    ...v,
                    metricId: val,
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
                  if (!("value" in option)) return false;
                  const metric = factMetrics.find((m) => m.id === option.value);
                  if (!metric) return false;
                  return !!getDisabledReason(metric, lockedClass);
                }}
                formatOptionLabel={({ value }, meta) => {
                  const metric = factMetrics.find((m) => m.id === value);
                  const label = metric ? <MetricName metric={metric} /> : value;
                  // Only attach the mix-restriction tooltip inside the open
                  // menu (not in the selected-value display) so it doesn't
                  // fire on every hover over the selected option.
                  const disabledReason =
                    meta.context === "menu" && metric
                      ? getDisabledReason(metric, lockedClass)
                      : null;
                  if (disabledReason) {
                    return (
                      <Tooltip body={disabledReason} usePortal>
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
              {selectedMetric && (
                <Link
                  href={`/fact-metrics/${selectedMetric.id}`}
                  external
                  size="sm"
                  mt="1"
                >
                  <Flex align="center" gap="1">
                    View definition
                    <PiArrowSquareOut />
                  </Flex>
                </Link>
              )}
              {population &&
              getEffectiveShowAs(draftExploreState, getFactMetricById) ===
                "per_unit" &&
              selectedMetric &&
              countsEveryPopulationMember(selectedMetric, v) ? (
                <Text size="sm" color="text-mid">
                  Every Population member counts for this metric, so its rate is
                  always 100%. Add a filter to measure a specific action.
                </Text>
              ) : null}
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
