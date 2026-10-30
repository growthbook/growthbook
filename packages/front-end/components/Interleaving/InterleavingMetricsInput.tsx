import { Box, Flex } from "@radix-ui/themes";
import {
  INTERLEAVING_RANKING_ID_COLUMN,
  type InterleavingAnalysis,
  type InterleavingMetricConfig,
} from "shared/validators";
import { isFactMetric } from "shared/experiments";
import { getInterleavingMetricIssue } from "shared/util";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import { useDefinitions } from "@/services/DefinitionsContext";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";

const PAIRED: InterleavingAnalysis = { type: "paired" };
const PREFERENCE: InterleavingAnalysis = {
  type: "preference",
  attribution: "exposureCount",
};

export function getMetricsError(
  metrics: InterleavingMetricConfig[],
): string | null {
  return metrics.some((m) => m.analyses.length === 0)
    ? "Select at least one analysis for each metric"
    : null;
}

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

  const supportsPaired = (metricId: string) => {
    const metric = getExperimentMetricById(metricId);
    if (!metric || !isFactMetric(metric) || !metric.numerator) return false;
    const factTable = getFactTableById(metric.numerator.factTableId);
    return !!factTable?.columns.some(
      (c) => c.column === INTERLEAVING_RANKING_ID_COLUMN && !c.deleted,
    );
  };

  const getMetricDisabledInfo = (metricId: string) => {
    const metric = getExperimentMetricById(metricId);
    if (!metric || !isFactMetric(metric)) return { disabled: false };
    const factTable = metric.numerator
      ? getFactTableById(metric.numerator.factTableId)
      : undefined;
    const issue = getInterleavingMetricIssue({
      metric,
      factTable: factTable ?? undefined,
      userIdType,
      analyses: [],
    });
    return issue ? { disabled: true, reason: issue } : { disabled: false };
  };

  const toggle = (
    metricId: string,
    analysis: InterleavingAnalysis,
    on: boolean,
  ) =>
    setValue(
      value.map((m) => {
        if (m.id !== metricId) return m;
        const rest = m.analyses.filter((a) => a.type !== analysis.type);
        return { ...m, analyses: on ? [...rest, analysis] : rest };
      }),
    );

  return (
    <Box>
      <Box mb="3">
        <Box mb="2">
          <Text as="label" weight="semibold">
            Metrics
          </Text>
        </Box>
        <MetricsSelector
          datasource={datasource}
          exposureQueryIdentifierType={userIdType}
          project={project}
          selected={value.map((m) => m.id)}
          onChange={(ids) =>
            setValue(
              ids.map(
                (id) =>
                  value.find((m) => m.id === id) ?? {
                    id,
                    analyses: supportsPaired(id)
                      ? [PAIRED, PREFERENCE]
                      : [PREFERENCE],
                  },
              ),
            )
          }
          includeFacts
          includeGroups={false}
          noLegacyMetrics
          noManual
          excludeQuantiles
          allowedFactMetricTypes={["mean", "proportion"]}
          getMetricDisabledInfo={getMetricDisabledInfo}
          disabled={disabled || !datasource}
          helpText="Paired analysis additionally needs a ranking_id column on the metric's fact table."
        />
      </Box>
      {value.length > 0 && (
        <Flex direction="column" gap="2" mb="3">
          {value.map((m) => {
            const pairedOk = supportsPaired(m.id);
            return (
              <Flex key={m.id} align="center" gap="4">
                <Box flexGrow="1">
                  <Text weight="medium">
                    {getExperimentMetricById(m.id)?.name ?? m.id}
                  </Text>
                </Box>
                {[PAIRED, PREFERENCE].map((analysis) => {
                  const checked = m.analyses.some(
                    (a) => a.type === analysis.type,
                  );
                  // Still allow unchecking a stale paired selection
                  const unsupported =
                    analysis.type === "paired" && !pairedOk && !checked;
                  return (
                    <Checkbox
                      key={analysis.type}
                      label={
                        analysis.type === "paired" ? "Paired" : "Preference"
                      }
                      value={checked}
                      setValue={(on) => toggle(m.id, analysis, on)}
                      disabled={disabled || unsupported}
                      disabledMessage={
                        unsupported
                          ? `Paired analysis needs a '${INTERLEAVING_RANKING_ID_COLUMN}' column on this metric's fact table.`
                          : undefined
                      }
                    />
                  );
                })}
              </Flex>
            );
          })}
          {getMetricsError(value) && (
            <HelperText status="error">{getMetricsError(value)}</HelperText>
          )}
        </Flex>
      )}
    </Box>
  );
}
