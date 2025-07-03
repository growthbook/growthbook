import { DimensionBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { isDefined } from "shared/util";
import { groupBy } from "lodash";
import { useDefinitions } from "@/services/DefinitionsContext";
import ResultsTable from "@/components/Experiment/ResultsTable";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useExperiments } from "@/hooks/useExperiments";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useDashboardSnapshot } from "../../DashboardSnapshotProvider";
import { BlockProps } from ".";

export default function DimensionBlock({
  block,
}: BlockProps<DimensionBlockInterface>) {
  const { metricIds, experimentId, baselineRow } = block;
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);

  const { getExperimentMetricById } = useDefinitions();
  const {
    snapshot,
    analysis,
    analysisSettings,
    loading,
  } = useDashboardSnapshot(block);
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;

  if (loading) return <LoadingSpinner />;

  if (!experiment || metricIds.length === 0 || !snapshot) return null;

  const variations = experiment.variations.map((v, i) => ({
    id: v.key || i + "",
    name: v.name,
    weight:
      experiment.phases[experiment.phases.length - 1]?.variationWeights?.[i] ||
      0,
  }));

  const latestPhase = experiment.phases[experiment.phases.length - 1];

  if (!analysis) return null;

  const result = analysis.results[0];
  if (!result) return null;

  const allRows = metricIds
    .map((metricId) => {
      const metric = getExperimentMetricById(metricId);
      if (!metric) return;
      // Determine which group the metric belongs to
      let resultGroup: "goal" | "secondary" | "guardrail" = "goal";
      if (experiment.secondaryMetrics.includes(metricId)) {
        resultGroup = "secondary";
      } else if (experiment.guardrailMetrics.includes(metricId)) {
        resultGroup = "guardrail";
      }
      return {
        label: metric.name,
        metric,
        variations: result.variations.map((v) => ({
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
        })),
        resultGroup,
        metricOverrideFields: [],
      };
    })
    .filter(isDefined);

  const rowGroups = groupBy(allRows, ({ resultGroup }) => resultGroup);

  return (
    <div>
      {Object.entries(rowGroups).map(([resultGroup, rows]) => (
        <ResultsTable
          key={resultGroup}
          id={experiment.id}
          phase={experiment.phases.length - 1}
          variations={variations}
          baselineRow={baselineRow}
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
      ))}
    </div>
  );
}
