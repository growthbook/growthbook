import React, { useState } from "react";
import { omit } from "lodash";
import { useGrowthBook } from "@growthbook/growthbook-react";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { AppFeatures } from "shared/types/app-features";
import type { ApiPopulation, MetricValue } from "shared/validators";
import { getMetricPopulationViolations } from "shared/enterprise";
import { isProjectListValidForProject } from "shared/util";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getPopulationFactTableId } from "@/enterprise/components/ProductAnalytics/metricMixing";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { usePopulations } from "@/hooks/usePopulations";

// Radix Select items can't use an empty string, so "no Population" needs a key.
const NO_POPULATION = "__none__";

/**
 * Picks the saved Population a metric chart is limited to, with the messages
 * that explain why one can't be used. Renders nothing unless the chart's
 * metrics can take a Population or one is already set.
 */
export default function PopulationPicker({
  unit,
}: {
  /** The chart's identifier type; a Population counts members by it. */
  unit: string | null;
}) {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();
  const { factTables, getFactMetricById, project } = useDefinitions();
  const gb = useGrowthBook<AppFeatures>();
  const populationsEnabled = !!gb?.isOn("populations");
  // Unfiltered, so a chart's Population still resolves when it belongs to
  // another Project; the options are filtered to the current Project below.
  const {
    populations,
    loading: populationsLoading,
    error: populationsError,
  } = usePopulations(undefined, { enabled: populationsEnabled });
  // Set when picking a Population removes the chart's Group By rows.
  const [removedGroupBy, setRemovedGroupBy] = useState(false);

  const values: MetricValue[] =
    draftExploreState.dataset?.type === "metric"
      ? draftExploreState.dataset.values
      : [];
  const population =
    draftExploreState.dataset?.type === "metric"
      ? draftExploreState.dataset.population
      : undefined;
  const hasPopulation = population !== undefined;

  // Only offer Populations that read from the metrics' shared Fact Table.
  const populationFactTableId = getPopulationFactTableId(
    values,
    getFactMetricById,
  );
  const populationCanBeCombined = (candidate: ApiPopulation) => {
    const isInThisProject = isProjectListValidForProject(
      candidate.projects,
      project,
    );
    const isOnThisDataSource =
      candidate.datasource === draftExploreState.datasource;
    const readsFromMetricsFactTable =
      candidate.steps[0]?.source.factTableId === populationFactTableId;
    const supportsChartUnit = !unit || candidate.userIdTypes.includes(unit);
    return (
      isInThisProject &&
      isOnThisDataSource &&
      readsFromMetricsFactTable &&
      supportsChartUnit
    );
  };
  const savedPopulation = population
    ? (populations.find((p) => p.id === population.populationId) ?? null)
    : null;
  const populationOptions = populations.filter(populationCanBeCombined);
  // The applied Population stays listed once it no longer fits, so the select
  // still names it; the Callout explains the conflict.
  if (savedPopulation && !populationOptions.includes(savedPopulation)) {
    populationOptions.push(savedPopulation);
  }
  const populationsLoaded = !populationsLoading && !populationsError;
  const noPopulationsFit =
    populationsLoaded && !hasPopulation && populationOptions.length === 0;

  const getPopulationViolations = (): string[] => {
    // There's nothing to check until the saved Populations load.
    if (!population || !populationsLoaded) return [];
    if (!savedPopulation) {
      return [
        "This Population was deleted or you don't have access to it. Choose another Population or None.",
      ];
    }
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

  const handlePopulationChange = (populationId: string) => {
    if (populationId === NO_POPULATION) {
      setRemovedGroupBy(false);
      setDraftExploreState((prev) =>
        prev.type === "metric"
          ? { ...prev, dataset: omit(prev.dataset, "population") }
          : prev,
      );
      return;
    }

    if (!unit) return;
    const hasGroupBy = draftExploreState.dimensions.some(
      (d) => d.dimensionType !== "date",
    );
    if (hasGroupBy) setRemovedGroupBy(true);

    setDraftExploreState((prev) => {
      if (prev.type !== "metric") return prev;

      // Populations can only be grouped by date.
      const dateDimensions = prev.dimensions.filter(
        (d) => d.dimensionType === "date",
      );
      // Adding a Population shows proportions as a share of it. Switching
      // between Populations keeps each value's choice.
      const isAddingPopulation = !prev.dataset.population;
      const nextValues: MetricValue[] = [];
      for (const value of prev.dataset.values) {
        const metric = getFactMetricById(value.metricId);
        if (isAddingPopulation && metric?.metricType === "proportion") {
          nextValues.push({ ...value, showAs: "percent_of_population" });
        } else {
          nextValues.push(value);
        }
      }
      return {
        ...prev,
        dimensions: dateDimensions,
        dataset: {
          ...prev.dataset,
          values: nextValues,
          population: { populationId, unit },
        },
      };
    });
  };

  // Keep the picker visible while a Population is set so it can be cleared.
  const showPicker =
    populationsEnabled && (populationFactTableId !== null || hasPopulation);
  if (!showPicker) return null;

  const populationViolations = getPopulationViolations();

  return (
    <>
      <Select
        label="Population"
        labelWeight="medium"
        value={
          populationsLoading
            ? undefined
            : (population?.populationId ?? NO_POPULATION)
        }
        placeholder="Loading..."
        disabled={!unit || populationsLoading || noPopulationsFit}
        error={
          unit ? undefined : "Select an identifier type to add a Population."
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
      {populationsError && (
        <Callout status="error">Unable to load Populations.</Callout>
      )}
      {noPopulationsFit && unit && (
        <HelperText status="warning">
          No Populations use this Fact Table and the {unit} identifier type.{" "}
          <Link href="/populations">Manage Populations</Link>
        </HelperText>
      )}
      {populationViolations.length === 1 && (
        <Callout status="warning">{populationViolations[0]}</Callout>
      )}
      {populationViolations.length > 1 && (
        <Callout status="warning">
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {populationViolations.map((violation) => (
              <li key={violation}>{violation}</li>
            ))}
          </ul>
        </Callout>
      )}
      {removedGroupBy && hasPopulation && (
        <Callout status="info">
          Group By was removed. Charts with a Population can only be grouped by
          date.
        </Callout>
      )}
    </>
  );
}
