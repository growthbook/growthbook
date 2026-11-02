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
import MultiSelectField from "@/ui/MultiSelectField";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { INTERLEAVING_ANALYSIS_TITLES } from "@/services/interleaving";

const PAIRED: InterleavingAnalysis = { type: "paired" };
const PREFERENCE: InterleavingAnalysis = {
  type: "preference",
  attribution: "exposureCount",
};

// Declaration order is the display order; the select is rendered with
// sort={false} so it stays Paired then Preference.
const ANALYSIS_OPTIONS: {
  type: InterleavingAnalysis["type"];
  analysis: InterleavingAnalysis;
}[] = [
  { type: "paired", analysis: PAIRED },
  { type: "preference", analysis: PREFERENCE },
];

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

  const setAnalyses = (metricId: string, types: string[]) =>
    setValue(
      value.map((m) =>
        m.id === metricId
          ? {
              ...m,
              // Rebuild from the canonical objects so attribution survives
              analyses: ANALYSIS_OPTIONS.filter((o) =>
                types.includes(o.type),
              ).map((o) => o.analysis),
            }
          : m,
      ),
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
          helpText="All metrics must come from a Fact Table with an `item_id` column. Paired analysis additionally needs a `ranking_id` column."
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
                <Box width="260px">
                  <MultiSelectField
                    aria-label="Analyses"
                    containerClassName="mb-0"
                    showCopyButton={false}
                    sort={false}
                    placeholder="Select analyses"
                    value={m.analyses.map((a) => a.type)}
                    options={ANALYSIS_OPTIONS.map((o) => ({
                      value: o.type,
                      label: INTERLEAVING_ANALYSIS_TITLES[o.type],
                      tooltip:
                        o.type === "paired" && !pairedOk
                          ? `Paired analysis needs a '${INTERLEAVING_RANKING_ID_COLUMN}' column on this metric's fact table.`
                          : undefined,
                    }))}
                    // A stale paired selection stays removable; it just can't
                    // be added back without the column.
                    isOptionDisabled={(o) =>
                      !("options" in o) &&
                      o.value === "paired" &&
                      !pairedOk &&
                      !m.analyses.some((a) => a.type === "paired")
                    }
                    onChange={(types) => setAnalyses(m.id, types)}
                    disabled={disabled}
                  />
                </Box>
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
