import { Box, Flex, Text, Tooltip } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import { FaCaretUp, FaCaretDown } from "react-icons/fa";
import clsx from "clsx";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { ExperimentMetricInterface } from "shared/src/experiments";
import {
  MetricSnapshotSettings,
  ExperimentReportVariationWithIndex,
} from "back-end/types/report";
import { pValueFormatter, RowResults } from "@/services/experiments";
import styles from "./FlagCard.module.scss";

const numberFormatter = Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function FlagCard({
  effectLabel,
  deltaFormatter,
  deltaFormatterOptions,
  pValueThreshold,
  data,
}: {
  effectLabel: string;
  deltaFormatter: (value: number, options?: Intl.NumberFormatOptions) => string;
  deltaFormatterOptions?: Intl.NumberFormatOptions;
  pValueThreshold: number;
  data: {
    metricRow: number;
    metric: ExperimentMetricInterface;
    metricSnapshotSettings?: MetricSnapshotSettings;
    dimensionName?: string;
    dimensionValue?: string;
    variation: ExperimentReportVariationWithIndex;
    stats: SnapshotMetric;
    baseline: SnapshotMetric;
    baselineVariation: ExperimentReportVariationWithIndex;
    rowResults: RowResults;
    statsEngine: StatsEngine;
    pValueCorrection?: PValueCorrection;
    isGuardrail: boolean;
  };
}) {
  const confidencePct = percentFormatter.format(1 - pValueThreshold);
  let pValText = (
    <>
      {data.stats?.pValue !== undefined
        ? pValueFormatter(data.stats.pValue)
        : ""}
    </>
  );
  if (
    data.stats?.pValueAdjusted !== undefined &&
    data.pValueCorrection &&
    !data.isGuardrail
  ) {
    pValText = (
      <>
        <div>{pValueFormatter(data.stats.pValueAdjusted)}</div>
        <Text size="1" color="gray">
          (unadj.:&nbsp;{pValText})
        </Text>
      </>
    );
  }
  // Lift units
  const ci1 = data.stats?.ciAdjusted?.[1] ?? data.stats?.ci?.[1] ?? Infinity;
  const ci0 = data.stats?.ciAdjusted?.[0] ?? data.stats?.ci?.[0] ?? -Infinity;
  const ciRangeText =
    data.stats?.ciAdjusted?.[0] !== undefined ? (
      <>
        <div>
          [{deltaFormatter(ci0, deltaFormatterOptions)},{" "}
          {deltaFormatter(ci1, deltaFormatterOptions)}]
        </div>
        <Text size="1" color="gray">
          (unadj.:&nbsp; [
          {deltaFormatter(
            data.stats.ci?.[0] ?? -Infinity,
            deltaFormatterOptions
          )}
          ,{" "}
          {deltaFormatter(
            data.stats.ci?.[1] ?? Infinity,
            deltaFormatterOptions
          )}
          ] )
        </Text>
      </>
    ) : (
      <>
        [
        {deltaFormatter(data.stats.ci?.[0] ?? -Infinity, deltaFormatterOptions)}
        ,{" "}
        {deltaFormatter(data.stats.ci?.[1] ?? Infinity, deltaFormatterOptions)}]
      </>
    );

  const getLabelText = () => {
    if (data.rowResults.significant) {
      return "SIGNIFICANT";
    } else {
      return "INSIGNIFICANT";
    }
  };

  const renderContentWithEnoughData = () => (
    <>
      <Box
        className={clsx(styles.labelContainer, {
          [styles.labelContainerWon]:
            data.rowResults.significant &&
            data.rowResults.resultsStatus === "won",
          [styles.labelContainerLost]:
            data.rowResults.significant &&
            data.rowResults.resultsStatus === "lost",
        })}
      >
        <Text weight="bold" size="1" className={styles.labelText}>
          <span>{getLabelText()}</span>
        </Text>
      </Box>

      <Flex direction="column" gap="2" p="3" width="100%">
        <CardItem
          label={effectLabel}
          value={
            <Flex
              align="center"
              gap="1"
              style={{
                color:
                  (data.rowResults.directionalStatus === "winning" &&
                    !data.metric.inverse) ||
                  (data.rowResults.directionalStatus === "losing" &&
                    data.metric.inverse)
                    ? "var(--green-11)"
                    : "var(--red-a11)",
              }}
            >
              {deltaFormatter(data.stats.expected ?? 0, deltaFormatterOptions)}
              {(data.rowResults.directionalStatus === "winning" &&
                !data.metric.inverse) ||
              (data.rowResults.directionalStatus === "losing" &&
                data.metric.inverse) ? (
                <FaCaretUp size={15} />
              ) : (
                <FaCaretDown size={15} />
              )}
            </Flex>
          }
        />

        <CardItem
          label={
            data.statsEngine === "bayesian"
              ? "95% Credible Interval"
              : `${confidencePct} Confidence Interval`
          }
          value={ciRangeText}
        />

        <CardItem
          label={data.statsEngine === "bayesian" ? "Chance to Win" : "P-Value"}
          value={
            data.statsEngine === "bayesian"
              ? percentFormatter.format(data.stats.chanceToWin ?? 0)
              : pValText
          }
          tooltip={
            <div>
              {data.statsEngine === "bayesian"
                ? data.rowResults.resultsReason
                : data.rowResults.significantReason}
              {!data.isGuardrail &&
              data.statsEngine === "frequentist" &&
              data.pValueCorrection ? (
                <>
                  <br />
                  <br />
                  Note that p-values have been corrected using the{" "}
                  {data.pValueCorrection} method.
                </>
              ) : null}
            </div>
          }
        />

        {data.rowResults.riskMeta.showRisk &&
        ["warning", "danger"].includes(data.rowResults.riskMeta.riskStatus) &&
        data.rowResults.resultsStatus !== "lost" ? (
          <CardItem
            label="Risk"
            tooltip={data.rowResults.riskMeta.riskReason}
            value={
              <span
                style={{
                  color:
                    data.rowResults.riskMeta.riskStatus === "danger"
                      ? "var(--red-a11)"
                      : data.rowResults.riskMeta.riskStatus === "warning"
                      ? "var(--amber-a11)"
                      : undefined,
                }}
              >
                {data.rowResults.riskMeta.relativeRiskFormatted}
                {data.rowResults.riskMeta.riskFormatted ? (
                  <>, {data.rowResults.riskMeta.riskFormatted}</>
                ) : null}
              </span>
            }
          />
        ) : null}
      </Flex>
    </>
  );

  const renderContent = () => {
    const numerator = data.rowResults.enoughDataMeta.percentCompleteNumerator;
    const denominator =
      data.rowResults.enoughDataMeta.percentCompleteDenominator;

    if (!data.rowResults.enoughData) {
      return (
        <Flex direction="column" gap="1" p="3">
          <Text
            size="1"
            weight="medium"
            style={{ color: "var(--color-text-mid)" }}
          >
            <i>Not enough data</i>{" "}
            <Tooltip content={data.rowResults.enoughDataMeta.reason}>
              <span>
                <PiInfo />
              </span>
            </Tooltip>
          </Text>

          <Text size="1" weight="medium">
            {numberFormatter.format(numerator)} /{" "}
            {numberFormatter.format(denominator)} (
            {percentFormatter.format(
              data.rowResults.enoughDataMeta.percentComplete
            )}
            )
          </Text>
        </Flex>
      );
    } else {
      return renderContentWithEnoughData();
    }
  };

  return (
    <Flex
      className={clsx(styles.flagCard, {
        [styles.flagCardWon]:
          data.rowResults.significant &&
          data.rowResults.resultsStatus === "won",
        [styles.flagCardLost]:
          data.rowResults.significant &&
          data.rowResults.resultsStatus === "lost",
      })}
    >
      {renderContent()}
    </Flex>
  );
}

function CardItem({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: React.ReactNode;
  tooltip?: React.ReactNode;
}) {
  return (
    <Flex justify="between">
      <span>
        {label}
        {tooltip ? (
          <>
            {" "}
            <Tooltip content={tooltip}>
              <span>
                <PiInfo />
              </span>
            </Tooltip>
          </>
        ) : null}
      </span>
      <span className={styles.cardItemValue}>{value}</span>
    </Flex>
  );
}
