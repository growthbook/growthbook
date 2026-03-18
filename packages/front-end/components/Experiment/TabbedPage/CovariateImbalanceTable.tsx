import { ExperimentReportVariation } from "shared/types/report";
import { CovariateImbalanceResult } from "shared/enterprise";
import { DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE } from "shared/constants";
import { pValueFormatter } from "@/services/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";

export interface Props {
  covariateImbalanceResult: CovariateImbalanceResult | null;
  variations: ExperimentReportVariation[];
  srm?: number;
}

const sampleSizeFormatter = Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const meanFormatter = Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const standardErrorFormatter = Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

const percentageFormatter = Intl.NumberFormat(undefined, {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function CovariateImbalanceMetricVariationTable({
  covariateImbalanceResult,
  variations,
}: Props) {
  const { getExperimentMetricById } = useDefinitions();
  const rows =
    covariateImbalanceResult?.metricVariationCovariateImbalanceResults ?? [];

  return (
    <table className="table mx-2 mt-0 mb-2">
      <thead>
        <tr>
          <th className="border-top-0 text-center">Metric</th>
          <th className="border-top-0 text-center">Variation</th>
          <th className="border-top-0 text-center">Sample size</th>
          <th className="border-top-0 text-center">Baseline mean (std)</th>
          <th className="border-top-0 text-center">Variation mean (std)</th>
          <th className="border-top-0 text-center">Percent change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const variation = variations[row.variation];
          const metric = getExperimentMetricById(row.metricId);

          return (
            <tr key={`${row.metricId}-${row.variation}`}>
              <td className="border-right">
                <b>{metric?.name ?? row.metricId}</b>
              </td>
              <td
                className={`border-right variation with-variation-label variation${row.variation}`}
              >
                <div className="d-flex align-items-center">
                  <span
                    className="label"
                    style={{
                      width: 20,
                      height: 20,
                    }}
                  >
                    {row.variation}
                  </span>{" "}
                  {variation?.name ?? ""}
                </div>
              </td>
              <td className="border-right text-right">
                {sampleSizeFormatter.format(row.variationSampleSize ?? 0)}
              </td>
              <td className="border-right text-right">
                <b>
                  {row.baselineMean !== undefined
                    ? meanFormatter.format(row.baselineMean)
                    : "-"}
                  {row.baselineStandardError !== undefined
                    ? ` (${standardErrorFormatter.format(
                        row.baselineStandardError,
                      )})`
                    : ""}
                </b>
              </td>
              <td className="border-right text-right">
                {row.variationMean !== undefined
                  ? meanFormatter.format(row.variationMean)
                  : "-"}
                {row.variationStandardError !== undefined
                  ? ` (${standardErrorFormatter.format(
                      row.variationStandardError,
                    )})`
                  : ""}
              </td>
              <td className="border-right text-right">
                {row.baselineMean !== undefined &&
                row.variationMean !== undefined &&
                row.baselineMean !== 0
                  ? percentageFormatter.format(
                      (row.variationMean - row.baselineMean) / row.baselineMean,
                    )
                  : "-"}
              </td>
            </tr>
          );
        })}
        {
          <tr className="text-left">
            <td colSpan={2} className="text-nowrap text-muted">
              {`p-value < ${pValueFormatter(
                DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE,
              )}`}
            </td>
            <td colSpan={4}></td>
          </tr>
        }
      </tbody>
    </table>
  );
}

function formatMetricTypeSummary(
  typeLabel: string,
  significant: number,
  total: number,
): string {
  if (total === 0) return "";
  return `For ${typeLabel.toLowerCase()} metrics, ${significant} of ${total} showed statistically significant differences.`;
}

export function CovariateImbalanceMetricSummaryTable(
  covariateImbalanceResult: CovariateImbalanceResult | null,
) {
  if (!covariateImbalanceResult) {
    return null;
  }

  const parts = [
    {
      label: "Goal",
      total: covariateImbalanceResult.numGoalMetrics,
      significant: covariateImbalanceResult.numGoalMetricsImbalanced,
    },
    {
      label: "Guardrail",
      total: covariateImbalanceResult.numGuardrailMetrics,
      significant: covariateImbalanceResult.numGuardrailMetricsImbalanced,
    },
    {
      label: "Secondary",
      total: covariateImbalanceResult.numSecondaryMetrics,
      significant: covariateImbalanceResult.numSecondaryMetricsImbalanced,
    },
  ]
    .filter((p) => p.total > 0)
    .map((p) => formatMetricTypeSummary(p.label, p.significant, p.total));

  if (parts.length === 0) return null;

  return (
    <div className="mx-2 mt-0 mb-2">
      {parts.map((part, i) => (
        <p key={i} className="mb-1">
          {part}
        </p>
      ))}
    </div>
  );
}
