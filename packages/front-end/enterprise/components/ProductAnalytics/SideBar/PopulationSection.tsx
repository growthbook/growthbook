import React, { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import type {
  ApiPopulation,
  ExplorationPopulation,
  MetricValue,
} from "shared/validators";
import type { FactMetricInterface } from "shared/types/fact-table";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import { useDefinitions } from "@/services/DefinitionsContext";
import { usePopulations } from "@/hooks/usePopulations";
import { describePopulationStep } from "@/components/Populations/populationUtils";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  findMatchingPopulation,
  getMetricPopulationConflict,
  getUnstackedChartType,
  toExplorationPopulation,
} from "@/enterprise/components/ProductAnalytics/util";

export default function PopulationSection() {
  const { draftExploreState, setDraftExploreState, populationViolations } =
    useExplorerContext();
  const { project, getFactMetricById, getFactTableById } = useDefinitions();
  const gb = useGrowthBook<AppFeatures>();
  const populationsEnabled = !!gb?.isOn("populations");
  const { populations, loading } = usePopulations(project, {
    enabled: populationsEnabled,
  });

  const dataset =
    draftExploreState.dataset.type === "metric"
      ? draftExploreState.dataset
      : null;
  const population = dataset?.population ?? null;
  const values: MetricValue[] = dataset?.values ?? [];

  const options = useMemo(
    () =>
      populations.filter(
        (p) =>
          p.datasource === draftExploreState.datasource && p.steps.length === 1,
      ),
    [populations, draftExploreState.datasource],
  );
  const matched = population
    ? findMatchingPopulation(population, options, draftExploreState.datasource)
    : null;

  if (!dataset || (!populationsEnabled && !population)) return null;

  const metrics = values
    .map((v) => getFactMetricById(v.metricId))
    .filter((m): m is FactMetricInterface => !!m);
  const hasGroupBy = draftExploreState.dimensions.some(
    (d) => d.dimensionType !== "date",
  );

  const getUnavailableReason = (p: ApiPopulation): string | null => {
    if (hasGroupBy) {
      return "Populations can only be grouped by date. Remove the other Group By columns first.";
    }
    if (values.some((v) => v.draftMetric)) {
      return "Populations only work with saved metrics.";
    }
    for (const m of metrics) {
      const conflict = getMetricPopulationConflict(
        m,
        p.steps[0].source.factTableId,
      );
      if (conflict === "metricType") {
        return `${m.name} isn't a Proportion metric. Populations only work with Proportion metrics.`;
      }
      if (conflict === "factTable") {
        return `${m.name} uses a different Fact Table than this Population.`;
      }
    }
    return null;
  };

  // Every metric is measured on the population's unit.
  const setPopulation = (next: ExplorationPopulation | null) => {
    setDraftExploreState((prev) => {
      // Narrow on prev.type: only it discriminates the config union.
      if (prev.type !== "metric") return prev;
      if (!next) {
        return { ...prev, dataset: { ...prev.dataset, population: undefined } };
      }
      // Membership is decided per date bucket, so weekly buckets give steadier
      // rates than "auto", which is often daily.
      const firstPick = !prev.dataset.population;
      return {
        ...prev,
        // A Mean metric's choice doesn't carry over; default to the percentage.
        showAs: firstPick ? undefined : prev.showAs,
        chartType: getUnstackedChartType(prev.chartType) ?? prev.chartType,
        dimensions: firstPick
          ? prev.dimensions.map((d) =>
              d.dimensionType === "date" && d.dateGranularity === "auto"
                ? { ...d, dateGranularity: "week" as const }
                : d,
            )
          : prev.dimensions,
        dataset: {
          ...prev.dataset,
          population: next,
          values: prev.dataset.values.map((v) => ({ ...v, unit: next.unit })),
        },
      };
    });
  };

  const selectPopulation = (id: string) => {
    const p = options.find((o) => o.id === id);
    if (!p) return setPopulation(null);
    const currentUnit = values.find((v) => v.unit)?.unit;
    const unit =
      currentUnit && p.userIdTypes.includes(currentUnit)
        ? currentUnit
        : p.userIdTypes[0];
    setPopulation(toExplorationPopulation(p, unit));
  };

  const description = population
    ? describePopulationStep({
        step: population,
        identifierTypes: [population.unit],
        factTable: getFactTableById(population.source.factTableId),
      })
        .map((segment) =>
          typeof segment === "string" ? segment : segment.label,
        )
        .join("")
    : "";
  const isCustom = !!population && !matched && !loading;

  return (
    <Flex direction="column" gap="2">
      <Text weight="medium">Population</Text>

      {populationsEnabled ? (
        <SelectField
          value={matched?.id ?? ""}
          onChange={selectPopulation}
          options={options.map((p) => ({ label: p.name, value: p.id }))}
          isClearable
          placeholder={isCustom ? "Replace with a Population..." : "None"}
          isOptionDisabled={(option) => {
            if (!("value" in option)) return false;
            const p = options.find((o) => o.id === option.value);
            return !!p && !!getUnavailableReason(p);
          }}
          formatOptionLabel={({ value, label }, meta) => {
            const p = options.find((o) => o.id === value);
            const reason =
              meta.context === "menu" && p ? getUnavailableReason(p) : null;
            if (!reason) return label;
            return (
              <Tooltip body={reason} usePortal>
                <span>{label}</span>
              </Tooltip>
            );
          }}
        />
      ) : null}

      {population && (isCustom || !populationsEnabled) ? (
        <Flex direction="column" gap="1">
          <Text size="sm" weight="medium">
            {populationsEnabled
              ? "Custom conditions"
              : "This exploration is filtered by a Population"}
          </Text>
          <Text size="sm" color="text-mid">
            {description}
          </Text>
          <Flex>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPopulation(null)}
            >
              Remove population
            </Button>
          </Flex>
        </Flex>
      ) : null}

      {populationsEnabled && matched && matched.userIdTypes.length > 1 ? (
        <SelectField
          label="Identifier type"
          value={population?.unit ?? ""}
          onChange={(unit) =>
            setPopulation(toExplorationPopulation(matched, unit))
          }
          options={matched.userIdTypes.map((t) => ({ label: t, value: t }))}
        />
      ) : null}

      {population && populationsEnabled ? (
        <Text size="sm" color="text-low">
          Applies to every metric. The Population&apos;s conditions are saved
          with this exploration, so later edits to the Population won&apos;t
          change it.
        </Text>
      ) : null}

      {populationViolations.length > 0 ? (
        <Callout status="error">
          <Flex direction="column" gap="2">
            <Text>This exploration can&apos;t run with a Population:</Text>
            <ul style={{ margin: 0, paddingLeft: "var(--space-4)" }}>
              {populationViolations.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
            <Flex>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPopulation(null)}
              >
                Remove population
              </Button>
            </Flex>
          </Flex>
        </Callout>
      ) : null}
    </Flex>
  );
}
