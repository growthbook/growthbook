import React, { useState } from "react";
import { omit } from "lodash";
import { useGrowthBook } from "@growthbook/growthbook-react";
import type { AppFeatures } from "shared/types/app-features";
import type { MetricValue } from "shared/validators";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  getMetricChartPopulationViolations,
  getPopulationFactTableId,
  populationFitsMetricChart,
} from "@/enterprise/components/ProductAnalytics/metricMixing";
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

  const values: MetricValue[] =
    draftExploreState.dataset?.type === "metric"
      ? draftExploreState.dataset.values
      : [];
  const population =
    draftExploreState.dataset?.type === "metric"
      ? draftExploreState.dataset.population
      : undefined;
  const hasPopulation = population !== undefined;

  // Unfiltered, so a chart's Population still resolves when it belongs to
  // another Project; the options are filtered to the current Project below.
  // Also fetched with the flag off while one is applied, so the select can
  // still name it.
  const {
    populations,
    loading: populationsLoading,
    error: populationsError,
    mutate: retryPopulations,
  } = usePopulations(undefined, {
    enabled: populationsEnabled || hasPopulation,
  });
  // The Population this picker applied while removing the chart's Group By
  // rows. The callout shows only while that Population is still applied.
  const [removedGroupByFor, setRemovedGroupByFor] = useState<string | null>(
    null,
  );
  // Another exploration, or another Population, isn't the one Group By was
  // removed for, so forget it.
  if (
    removedGroupByFor !== null &&
    removedGroupByFor !== population?.populationId
  ) {
    setRemovedGroupByFor(null);
  }

  // Only offer Populations that read from the metrics' shared Fact Table.
  const populationFactTableId = getPopulationFactTableId(
    values,
    getFactMetricById,
  );
  const savedPopulation = population
    ? (populations.find((p) => p.id === population.populationId) ?? null)
    : null;
  const populationOptions = populations.filter((candidate) =>
    populationFitsMetricChart(candidate, {
      project,
      datasource: draftExploreState.datasource,
      factTableId: populationFactTableId,
      unit,
    }),
  );
  // The applied Population stays listed once it no longer fits, so the select
  // still names it; the Callout explains the conflict.
  if (savedPopulation && !populationOptions.includes(savedPopulation)) {
    populationOptions.push(savedPopulation);
  }
  // A failed refresh keeps the cached list, so only a failed first fetch
  // leaves none. usePopulations returns the list rather than its data, so a
  // cached empty list that then fails to refresh also counts as none.
  const hasPopulationList =
    !populationsLoading && (!populationsError || populations.length > 0);
  const noPopulationsFit =
    hasPopulationList && !hasPopulation && populationOptions.length === 0;

  const getPopulationViolations = (): string[] => {
    // Without a list, whether the applied Population still exists is unknown.
    if (!population || !hasPopulationList) return [];
    return getMetricChartPopulationViolations({
      population,
      savedPopulation,
      values,
      dimensions: draftExploreState.dimensions,
      datasource: draftExploreState.datasource,
      getFactMetricById,
      factTables,
    });
  };

  const handlePopulationChange = (populationId: string) => {
    if (populationId === NO_POPULATION) {
      setRemovedGroupByFor(null);
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
    setRemovedGroupByFor(hasGroupBy ? populationId : null);

    setDraftExploreState((prev) => {
      if (prev.type !== "metric") return prev;

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
  };

  // Keep the picker visible while a Population is set so it can be cleared,
  // even with the flag off.
  const showPicker =
    (populationsEnabled && populationFactTableId !== null) || hasPopulation;
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
        // Without a list or an identifier type, None stays selectable while a
        // Population is applied, so the chart is never stuck filtered by one.
        disabled={
          (!unit && !hasPopulation) ||
          populationsLoading ||
          (!hasPopulationList && !hasPopulation) ||
          noPopulationsFit
        }
        error={
          unit || hasPopulation
            ? undefined
            : "Select an identifier type to add a Population."
        }
        errorLevel="warning"
        setValue={handlePopulationChange}
      >
        <SelectItem value={NO_POPULATION}>None</SelectItem>
        {/* Without a list, the applied filter still shows, as a status rather
            than something that reads like a Population's name. */}
        {!hasPopulationList && population && (
          <SelectItem
            value={population.populationId}
            textValue="Name couldn't be loaded"
          >
            <Text color="text-low" fontStyle="italic">
              Name couldn&apos;t be loaded
            </Text>
          </SelectItem>
        )}
        {populationOptions.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </Select>
      {populationsError && (
        <Callout status="error">
          Unable to load Populations.{" "}
          <Link onClick={() => retryPopulations()}>Try again</Link>
        </Callout>
      )}
      {noPopulationsFit && unit && (
        <HelperText status="warning">
          No Populations in this Project use this Fact Table and the {unit}{" "}
          identifier type.{" "}
          <Link href="/populations" external>
            Manage Populations
          </Link>
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
      {removedGroupByFor !== null &&
        removedGroupByFor === population?.populationId && (
          <Callout status="info">
            Group By was removed. Charts with a Population can only be grouped
            by date.
          </Callout>
        )}
    </>
  );
}
