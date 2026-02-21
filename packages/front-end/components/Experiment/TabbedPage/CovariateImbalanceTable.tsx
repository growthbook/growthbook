import { ExperimentReportVariation } from "back-end/types/report";
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
            <td colSpan={3}></td>
          </tr>
        }
      </tbody>
    </table>
  );
}

export function CovariateImbalanceMetricSummaryTable(
  covariateImbalanceResult: CovariateImbalanceResult | null,
) {
  if (!covariateImbalanceResult) {
    return null;
  }

  const rows = [
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
  ];

  const totals = rows.reduce(
    (acc, row) => {
      acc.total += row.total;
      acc.significant += row.significant;
      return acc;
    },
    { total: 0, significant: 0 },
  );

  const data = [...rows, { label: "Total", ...totals }];

  return (
    <table className="table mx-2 mt-0 mb-2">
      <thead>
        <tr>
          <th className="border-top-0 text-center">Metric Type</th>
          <th className="border-top-0 text-center">Significant</th>
          <th className="border-top-0 text-center">Total</th>
          <th className="border-top-0 text-center">Percentage</th>
        </tr>
      </thead>
      <tbody>
        {data.map(({ label, significant, total }) => (
          <tr key={label}>
            <td className="border-right">
              <b>{label}</b>
            </td>
            <td className="border-right text-right">
              {sampleSizeFormatter.format(significant)}
            </td>
            <td className="border-right text-right">
              {sampleSizeFormatter.format(total)}
            </td>
            <td className="text-right">
              {total > 0
                ? percentageFormatter.format(significant / total)
                : "-"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
