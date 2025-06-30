import { DimensionBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { useDefinitions } from "@/services/DefinitionsContext";
import ResultsTable from "@/components/Experiment/ResultsTable";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useExperiments } from "@/hooks/useExperiments";
import { useDashboardSnapshot } from "../../DashboardSnapshotProvider";
import { BlockProps } from ".";

export default function DimensionBlock({
  block,
}: BlockProps<DimensionBlockInterface>) {
  const { metricId: metricIdOverride, experimentId } = block;
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);

  const { snapshot, analysisSettings } = useDashboardSnapshot(block);
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;

  const metricId = metricIdOverride || "";

  const { getExperimentMetricById } = useDefinitions();

  const metric = getExperimentMetricById(metricId);

  if (!experiment || !metric) return null;

  const variations = experiment.variations.map((v, i) => ({
    id: v.key || i + "",
    name: v.name,
    weight:
      experiment.phases[experiment.phases.length - 1]?.variationWeights?.[i] ||
      0,
  }));

  const latestPhase = experiment.phases[experiment.phases.length - 1];
  const latestResults = snapshot?.analyses?.[0]?.results?.[0];

  // Determine which group the metric belongs to
  let resultGroup: "goal" | "secondary" | "guardrail" = "goal";
  if (experiment.secondaryMetrics.includes(metricId)) {
    resultGroup = "secondary";
  } else if (experiment.guardrailMetrics.includes(metricId)) {
    resultGroup = "guardrail";
  }

  const rows = [
    {
      label: metric.name,
      metric,
      variations:
        latestResults?.variations?.map((v) => ({
          value: v.metrics[metricId]?.value || 0,
          cr: v.metrics[metricId]?.cr || 0,
          users: v.users,
          denominator: v.metrics[metricId]?.denominator,
          ci: v.metrics[metricId]?.ci,
          ciAdjusted: v.metrics[metricId]?.ciAdjusted,
          expected: v.metrics[metricId]?.expected,
          risk: v.metrics[metricId]?.risk,
          riskType: v.metrics[metricId]?.riskType,
          stats: v.metrics[metricId]?.stats,
          pValue: v.metrics[metricId]?.pValue,
          pValueAdjusted: v.metrics[metricId]?.pValueAdjusted,
          uplift: v.metrics[metricId]?.uplift,
          buckets: v.metrics[metricId]?.buckets,
          chanceToWin: v.metrics[metricId]?.chanceToWin,
          errorMessage: v.metrics[metricId]?.errorMessage,
          power: v.metrics[metricId]?.power,
        })) || [],
      resultGroup,
      metricOverrideFields: [],
    },
  ];

  return (
    <div className="dimension-block">
      <ResultsTable
        id={experiment.id}
        variations={variations}
        status={experiment.status}
        isLatestPhase={true}
        startDate={latestPhase?.dateStarted || ""}
        endDate={latestPhase?.dateEnded || ""}
        rows={rows}
        tableRowAxis="metric"
        labelHeader={`${
          resultGroup.charAt(0).toUpperCase() + resultGroup.slice(1)
        } Metrics`}
        renderLabelColumn={(label) => label}
        dateCreated={new Date()}
        hasRisk={false}
        statsEngine={orgSettings?.statsEngine || "frequentist"}
        pValueCorrection={pValueCorrection}
        differenceType={analysisSettings?.differenceType || "relative"}
        isTabActive={true}
        isGoalMetrics={resultGroup === "goal"}
      />
    </div>
  );
}
