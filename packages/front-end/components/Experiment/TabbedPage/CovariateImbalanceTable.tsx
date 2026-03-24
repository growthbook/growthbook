import { ExperimentReportVariation } from "shared/types/report";
import {
  CovariateImbalanceResult,
  MetricVariationCovariateImbalanceResult,
} from "shared/health";
import { useState } from "react";
import { DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE } from "shared/constants";
import { pValueFormatter } from "@/services/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
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
  goalMetricIds: string[];
  secondaryMetricIds: string[];
  guardrailMetricIds: string[];
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

const VISIBLE_ROW_COUNT = 5;

function splitRowsByMetricType(
  covariateImbalanceResult: CovariateImbalanceResult | null,
  goalMetricIds: string[],
  secondaryMetricIds: string[],
  guardrailMetricIds: string[],
) {
  const rows =
    covariateImbalanceResult?.metricVariationCovariateImbalanceResults ?? [];
  const goalSet = new Set(goalMetricIds);
  const secondarySet = new Set(secondaryMetricIds);
  const guardrailSet = new Set(guardrailMetricIds);

  const goalRows = rows.filter((row) => goalSet.has(row.metricId));
  const secondaryRows = rows.filter((row) => secondarySet.has(row.metricId));
  const guardrailRows = rows.filter((row) => guardrailSet.has(row.metricId));

  return { goalRows, guardrailRows, secondaryRows };
}

interface CovariateImbalanceTableProps {
  type: "goal" | "secondary" | "guardrail";
  rows: MetricVariationCovariateImbalanceResult[];
  variations: ExperimentReportVariation[];
  getExperimentMetricById: ReturnType<
    typeof useDefinitions
  >["getExperimentMetricById"];
}

function CovariateImbalanceTableSection({
  type,
  rows,
  variations,
  getExperimentMetricById,
}: CovariateImbalanceTableProps) {
  const [expanded, setExpanded] = useState(false);

  const visibleRows = expanded ? rows : rows.slice(0, VISIBLE_ROW_COUNT);

  if (!rows.length) return null;
  return (
    <div className="mb-4">
      <Table size="1" className="mx-2 mt-0 mb-2">
        <TableHeader>
          <TableRow>
            <TableColumnHeader className="text-center">
              {type} Metrics ({rows.length})
            </TableColumnHeader>
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
              % change
            </TableColumnHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((row) => {
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
                        (row.variationMean - row.baselineMean) /
                          row.baselineMean,
                      )
                    : "-"}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow className="text-left">
            <TableCell colSpan={2} className="text-nowrap text-muted">
              {`p-value < ${pValueFormatter(
                DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE,
              )}`}
            </TableCell>
            <TableCell colSpan={4}></TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {!expanded && rows.length > VISIBLE_ROW_COUNT && (
        <div className="mx-2">
          <Button variant="ghost" size="xs" onClick={() => setExpanded(true)}>
            Show more...
          </Button>
        </div>
      )}
    </div>
  );
}

export function CovariateImbalanceMetricVariationTable({
  covariateImbalanceResult,
  variations,
  goalMetricIds,
  secondaryMetricIds,
  guardrailMetricIds,
}: Props) {
  const { getExperimentMetricById } = useDefinitions();
  const { goalRows, guardrailRows, secondaryRows } = splitRowsByMetricType(
    covariateImbalanceResult,
    goalMetricIds,
    secondaryMetricIds,
    guardrailMetricIds,
  );

  return (
    <>
      <CovariateImbalanceTableSection
        type="goal"
        rows={goalRows}
        variations={variations}
        getExperimentMetricById={getExperimentMetricById}
      />
      <CovariateImbalanceTableSection
        type="secondary"
        rows={secondaryRows}
        variations={variations}
        getExperimentMetricById={getExperimentMetricById}
      />
      <CovariateImbalanceTableSection
        type="guardrail"
        rows={guardrailRows}
        variations={variations}
        getExperimentMetricById={getExperimentMetricById}
      />
    </>
  );
}
