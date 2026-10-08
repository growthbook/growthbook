import { Box, Flex } from "@radix-ui/themes";
import { ago } from "shared/dates";
import { getMetricLink } from "shared/experiments";
import { ApiContextualBanditInterface } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCurrency } from "@/hooks/useCurrency";
import {
  formatPercent,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import { ContextualBanditMeasurementArmResults } from "@/hooks/useContextualBandits";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";

export default function ContextualBanditMeasurementArmSummary({
  cb,
  measurementArm,
}: {
  cb: ApiContextualBanditInterface;
  measurementArm: ContextualBanditMeasurementArmResults | null;
}) {
  const { getExperimentMetricById, getFactTableById } = useDefinitions();
  const displayCurrency = useCurrency();

  if (!cb.measurementArm?.enabled) return null;

  const percentLabel = formatPercent(cb.measurementArm.percent);
  const experimentHref = measurementArm
    ? `/experiment/${measurementArm.experimentId}`
    : cb.measurementArm.experimentId
      ? `/experiment/${cb.measurementArm.experimentId}`
      : null;

  const result = measurementArm?.decisionMetricResult ?? null;
  const metric = result ? getExperimentMetricById(result.metricId) : null;
  const formatMean = (v: number | null) =>
    v == null
      ? "—"
      : metric
        ? getExperimentMetricFormatter(metric, getFactTableById)(v, {
            currency: displayCurrency,
          })
        : String(v);

  let body: React.ReactNode;
  if (cb.status === "draft") {
    body = (
      <Text color="text-mid">
        {percentLabel} of eligible users will be held back at the linked
        feature&apos;s default value once the bandit starts.
      </Text>
    );
  } else if (!result) {
    body = (
      <Text color="text-mid">
        {measurementArm?.latestSnapshot?.status === "error"
          ? "The last measurement arm update failed."
          : "Collecting data — results appear after the first analysis runs."}
      </Text>
    );
  } else {
    const liftText =
      result.lift != null
        ? `${result.lift >= 0 ? "+" : ""}${formatPercent(result.lift)}`
        : "—";
    const ciText =
      result.ci && result.ci[0] != null && result.ci[1] != null
        ? ` (${formatPercent(result.ci[0])} to ${formatPercent(result.ci[1])})`
        : "";
    const confidenceText =
      result.chanceToWin != null
        ? ` · ${formatPercent(result.chanceToWin)} chance the bandit wins`
        : result.pValue != null
          ? ` · p = ${result.pValue.toFixed(3)}`
          : "";
    body = (
      <Flex direction="column" gap="1">
        <Text>
          Bandit vs. measurement arm: <Text weight="semibold">{liftText}</Text>
          {ciText} on{" "}
          {metric ? (
            <Link href={getMetricLink(metric.id)}>{metric.name}</Link>
          ) : (
            result.metricId
          )}
          {confidenceText}
        </Text>
        <Text color="text-mid" size="sm">
          Measurement arm {formatMean(result.controlMean)} (
          {result.controlUsers ?? "—"} users) · Bandit{" "}
          {formatMean(result.banditMean)} ({result.banditUsers ?? "—"} users)
          {measurementArm?.latestSnapshot
            ? ` · Updated ${ago(measurementArm.latestSnapshot.dateCreated)}`
            : ""}
        </Text>
      </Flex>
    );
  }

  return (
    <Frame mb="4">
      <Flex justify="between" align="start" gap="4" wrap="wrap">
        <Box>
          <Flex align="center" gap="2" mb="2">
            <Heading as="h4" size="sm" mb="0">
              Measurement arm
            </Heading>
            <Badge label={`${percentLabel} held back`} color="gray" />
          </Flex>
          {body}
        </Box>
        {experimentHref ? (
          <Link href={experimentHref} target="_blank" rel="noreferrer">
            See full results →
          </Link>
        ) : null}
      </Flex>
    </Frame>
  );
}
