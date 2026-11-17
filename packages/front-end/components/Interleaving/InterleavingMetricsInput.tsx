import { useCallback } from "react";
import { Box } from "@radix-ui/themes";
import {
  type InterleavingAnalysis,
  type InterleavingMetricConfig,
} from "shared/validators";
import { isFactMetric } from "shared/experiments";
import { getInterleavingMetricIssue } from "shared/util";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import { useDefinitions } from "@/services/DefinitionsContext";
import Text from "@/ui/Text";
import { INTERLEAVING_ANALYSIS_TITLES } from "@/services/interleaving";

const PAIRED: InterleavingAnalysis = { type: "paired" };
const PREFERENCE: InterleavingAnalysis = {
  type: "preference",
  attribution: "exposureCount",
};

const SELECTORS: {
  type: InterleavingAnalysis["type"];
  analysis: InterleavingAnalysis;
  description: string;
}[] = [
  {
    type: "paired",
    analysis: PAIRED,
    description:
      "Credited per engaged impression, compared within the same ranked list. Additionally needs a `ranking_id` column.",
  },
  {
    type: "preference",
    analysis: PREFERENCE,
    description:
      "Each exposed user is credited to the ranker whose items they engaged with more.",
  },
];

export default function InterleavingMetricsInput({
  value,
  setValue,
  datasource,
  userIdType,
  project,
  disabled,
}: {
  value: InterleavingMetricConfig[];
  setValue: (value: InterleavingMetricConfig[]) => void;
  datasource: string;
  userIdType: string;
  project?: string;
  disabled?: boolean;
}) {
  const { getExperimentMetricById, getFactTableById } = useDefinitions();

  // The shared util's only use of `analyses` is to require ranking_id for
  // paired, so each selector gates itself by passing its own analysis.
  const issueFor = useCallback(
    (metricId: string, analyses: InterleavingAnalysis[]) => {
      const metric = getExperimentMetricById(metricId);
      if (!metric || !isFactMetric(metric)) return { disabled: false };
      const factTable = metric.numerator
        ? getFactTableById(metric.numerator.factTableId)
        : undefined;
      const issue = getInterleavingMetricIssue({
        metric,
        factTable: factTable ?? undefined,
        userIdType,
        analyses,
      });
      return issue ? { disabled: true, reason: issue } : { disabled: false };
    },
    [getExperimentMetricById, getFactTableById, userIdType],
  );

  const pairedDisabledInfo = useCallback(
    (metricId: string) => issueFor(metricId, [PAIRED]),
    [issueFor],
  );
  const preferenceDisabledInfo = useCallback(
    (metricId: string) => issueFor(metricId, []),
    [issueFor],
  );

  const selectedFor = (type: InterleavingAnalysis["type"]) =>
    value
      .filter((m) => m.analyses.some((a) => a.type === type))
      .map((m) => m.id);

  // Rebuilt from both lists on every change: a metric in neither is omitted
  // (Zod requires analyses.min(1)) and one in both is a single config.
  const setSelected = (type: InterleavingAnalysis["type"], ids: string[]) => {
    const next = new Map<string, InterleavingAnalysis[]>();
    for (const { type: t, analysis } of SELECTORS) {
      const selected = t === type ? ids : selectedFor(t);
      for (const id of selected) {
        next.set(id, [...(next.get(id) ?? []), analysis]);
      }
    }
    setValue([...next].map(([id, analyses]) => ({ id, analyses })));
  };

  return (
    <Box>
      {SELECTORS.map(({ type, description }) => (
        <Box key={type} mb="3">
          <Box mb="1">
            <Text as="label" weight="semibold">
              {INTERLEAVING_ANALYSIS_TITLES[type]} metrics
            </Text>
          </Box>
          <Box mb="2">
            <Text as="p" size="sm" color="text-mid">
              {description}
            </Text>
          </Box>
          <MetricsSelector
            datasource={datasource}
            exposureQueryIdentifierType={userIdType}
            project={project}
            selected={selectedFor(type)}
            onChange={(ids) => setSelected(type, ids)}
            includeFacts
            includeGroups={false}
            noLegacyMetrics
            noManual
            excludeQuantiles
            allowedFactMetricTypes={["mean", "proportion"]}
            getMetricDisabledInfo={
              type === "paired" ? pairedDisabledInfo : preferenceDisabledInfo
            }
            disabled={disabled || !datasource}
          />
        </Box>
      ))}
      <Box mb="3">
        <Text as="p" size="sm" color="text-mid">
          All metrics must come from a Fact Table with an <code>item_id</code>{" "}
          column.
        </Text>
      </Box>
    </Box>
  );
}
