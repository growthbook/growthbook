import { daysBetween } from "shared/dates";
import {
  getSnapshotAnalysis,
  meanVarianceFromSums,
  ratioVarianceFromSums,
} from "shared/util";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { PopulationDataInterface } from "shared/types/population-data";
import { PowerCalculationForm } from "@/components/PowerCalculation/PowerCalculationSettingsModal";
import { AuthContextValue } from "@/services/auth";

export async function setMetricDataFromExperiment({
  form,
  experiment,
  apiCall,
}: {
  form: PowerCalculationForm;
  experiment?: ExperimentInterfaceStringDates;
  apiCall: AuthContextValue["apiCall"];
}) {
  if (!experiment) {
    form.setValue("metricValuesData.error", `Experiment not found.`);
    return;
  }

  try {
    const phase = experiment.phases.length - 1;
    const { snapshot: standardSnapshot } = await apiCall<{
      snapshot: ExperimentSnapshotInterface;
    }>(`/experiment/${experiment.id}/snapshot/${phase}/?type=standard`);
    let snapshot = standardSnapshot;
    if (!snapshot) {
      // if above fails, maybe snapshots are legacy and don't have type = standard
      // so try one more time
      const { snapshot: anyTypeSnapshot } = await apiCall<{
        snapshot: ExperimentSnapshotInterface;
      }>(`/experiment/${experiment.id}/snapshot/${phase}`);

      if (anyTypeSnapshot) {
        snapshot = anyTypeSnapshot;
      } else {
        form.setValue(
          "metricValuesData.error",
          `No data found for the experiment.`,
        );
        return;
      }
    }

    const metrics = form.watch("metrics");
    const metricIds = Object.keys(metrics);

    const analysis = getSnapshotAnalysis(snapshot);

    // use total traffic for traffic
    const units =
      snapshot.health?.traffic.overall.variationUnits.reduce(
        (result, v) => v + result,
        0,
      ) ?? 0;

    const experimentPhase = experiment.phases[phase];
    const phaseLength = daysBetween(
      experimentPhase.dateStarted ?? new Date(),
      experimentPhase.dateEnded ?? new Date(),
    );
    const lengthWeeks = phaseLength / 7;
    let newMetrics = {};
    let totalUnits = 0;

    analysis?.results?.[0]?.variations?.forEach((v, i) => {
      // use control only for metric mean and variance
      if (i === 0) {
        metricIds.forEach((metricId) => {
          const mean = v.metrics[metricId].stats?.mean;
          const standardDeviation = v.metrics[metricId].stats?.stddev;
          newMetrics = {
            ...newMetrics,
            [metricId]: {
              ...metrics[metricId],
              mean,
              conversionRate: mean,
              standardDeviation,
            },
          };
        });
      }
      if (!units) {
        totalUnits += v.users;
      }
    });

    const usersPerWeek = Math.round((units || totalUnits) / lengthWeeks);
    form.setValue("metrics", newMetrics);
    form.setValue("usersPerWeek", usersPerWeek);

    form.setValue("savedData", {
      usersPerWeek: usersPerWeek,
      metrics: newMetrics,
    });
  } catch (e) {
    console.error(e.message);
    form.setValue("metricValuesData.error", e.message);
  }
}

export function setMetricDataFromPopulationData({
  populationData,
  form,
}: {
  populationData: PopulationDataInterface;
  form: PowerCalculationForm;
}) {
  const metrics = form.watch("metrics");

  if (populationData?.status !== "success") return;
  Object.entries(metrics).forEach(([id, metric]) => {
    const queryMetric = populationData.metrics.find((m) => m.metricId === id);
    if (!queryMetric) {
      metrics[id] = {
        ...metric,
        ...(metric.type === "binomial"
          ? { conversionRate: 0 }
          : { mean: 0, standardDeviation: 0 }),
      };
      return;
    }

    const mdata = queryMetric.data;

    const isRatioMetric =
      mdata.denominator_sum ||
      mdata.denominator_sum_squares ||
      mdata.main_denominator_sum_product;

    if (isRatioMetric && metric.type === "mean") {
      const mean = mdata.main_sum / (mdata.denominator_sum ?? 0);
      const standardDeviation = ratioVarianceFromSums({
        numerator_sum: mdata.main_sum,
        numerator_sum_squares: mdata.main_sum_squares,
        denominator_sum: mdata.denominator_sum ?? 0,
        denominator_sum_squares: mdata.denominator_sum_squares ?? 0,
        numerator_denominator_sum_product:
          mdata.main_denominator_sum_product ?? 0,
        n: mdata.count,
      });
      metrics[id] = {
        ...metric,
        mean,
        standardDeviation,
      };
      return;
    }

    if (metric.type === "binomial") {
      const mean = (mdata.count ?? 0) === 0 ? 0 : mdata.main_sum / mdata.count;
      metrics[id] = {
        ...metric,
        conversionRate: mean,
      };
      return;
    }

    const mean = (mdata.count ?? 0) === 0 ? 0 : mdata.main_sum / mdata.count;
    const standardDeviation = meanVarianceFromSums(
      mdata.main_sum,
      mdata.main_sum_squares,
      mdata.count,
    );
    metrics[id] = {
      ...metric,
      mean,
      standardDeviation,
    };
  });
  const usersPerWeek = Math.round(
    populationData.units.reduce((r, u) => {
      return r + u.count;
    }, 0) / (populationData.units.length ?? 1),
  );
  form.setValue("metrics", metrics);
  form.setValue("usersPerWeek", isNaN(usersPerWeek) ? 0 : usersPerWeek);

  form.setValue("savedData", {
    usersPerWeek: isNaN(usersPerWeek) ? 0 : usersPerWeek,
    metrics: metrics,
  });
}

export async function postPopulationData({
  form,
  apiCall,
  force = false,
}: {
  form: PowerCalculationForm;
  apiCall: AuthContextValue["apiCall"];
  force?: boolean;
}): Promise<{ populationData?: PopulationDataInterface }> {
  const metricValuesData = form.watch("metricValuesData");
  const sourceType = metricValuesData?.source;
  const metricIds = Object.keys(form.watch("metrics"));
  const userIdType = metricValuesData?.identifierType;
  const datasourceId = metricValuesData?.datasource;
  const sourceId = metricValuesData?.sourceId;
  const res = await apiCall<{
    populationData: PopulationDataInterface;
  }>(`/population-data`, {
    method: "POST",
    body: JSON.stringify({
      metricIds,
      datasourceId,
      sourceType,
      sourceId,
      userIdType,
      force,
    }),
  });
  return res;
}
