import { ExperimentReportVariation } from "shared/types/report";
import { CovariateImbalanceResult } from "shared/health";
import { DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE } from "shared/constants";
import { pValueFormatter } from "@/services/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

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
    <Table size="1" className="mx-2 mt-0 mb-2">
      <TableHeader>
        <TableRow>
          <TableColumnHeader className="text-center">Metric</TableColumnHeader>
          <TableColumnHeader className="text-center">
            Variation
          </TableColumnHeader>
          <TableColumnHeader className="text-center">
            Sample size
          </TableColumnHeader>
          <TableColumnHeader className="text-center">
            Baseline mean (std)
          </TableColumnHeader>
          <TableColumnHeader className="text-center">
            Variation mean (std)
          </TableColumnHeader>
          <TableColumnHeader className="text-center">
            Percent change
          </TableColumnHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const variation = variations[row.variation];
          const metric = getExperimentMetricById(row.metricId);

          return (
            <TableRow key={`${row.metricId}-${row.variation}`}>
              <TableCell className="border-right">
                <b>{metric?.name ?? row.metricId}</b>
              </TableCell>
              <TableCell
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
              </TableCell>
              <TableCell className="border-right text-right">
                {sampleSizeFormatter.format(row.variationSampleSize ?? 0)}
              </TableCell>
              <TableCell className="border-right text-right">
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
              </TableCell>
              <TableCell className="border-right text-right">
                {row.variationMean !== undefined
                  ? meanFormatter.format(row.variationMean)
                  : "-"}
                {row.variationStandardError !== undefined
                  ? ` (${standardErrorFormatter.format(
                      row.variationStandardError,
                    )})`
                  : ""}
              </TableCell>
              <TableCell className="border-right text-right">
                {row.baselineMean !== undefined &&
                row.variationMean !== undefined &&
                row.baselineMean !== 0
                  ? percentageFormatter.format(
                      (row.variationMean - row.baselineMean) / row.baselineMean,
                    )
                  : "-"}
              </TableCell>
            </TableRow>
          );
        })}
        {
          <TableRow className="text-left">
            <TableCell colSpan={2} className="text-nowrap text-muted">
              {`p-value < ${pValueFormatter(
                DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE,
              )}`}
            </TableCell>
            <TableCell colSpan={4}></TableCell>
          </TableRow>
        }
      </TableBody>
    </Table>
  );
}
