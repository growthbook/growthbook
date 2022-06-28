import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";
import React, { useMemo } from "react";
import { FaFileExport } from "react-icons/fa";
import { useDefinitions } from "../../services/DefinitionsContext";
import { ExperimentTableRow, getRisk } from "../../services/experiments";
import { Parser } from "json2csv";

type UpdatedRow = {
  dimension?: string;
  metricName?: string;
  variantName?: string;
  riskOfChoosing?: number;
  users?: number;
  count?: number;
  conversionRate?: number;
  chanceToBeatControl?: number | null;
  percentChange?: number | null;
};

export default function ResultsDownloadButton({
  results,
  metrics,
  variations,
  trackingKey,
  dimension,
}: {
  results?: ExperimentReportResultDimension[];
  metrics: string[];
  variations: ExperimentReportVariation[];
  trackingKey: string;
  dimension: string;
}) {
  const { getMetricById, getDimensionById, ready } = useDefinitions();

  const json2csvParser = new Parser();

  const csvRows = [];
  const rows = [];

  const dimensionName = getDimensionById(dimension);

  results.forEach((result) => {
    const rowsArr = useMemo<ExperimentTableRow[]>(() => {
      if (!result || !result.variations || !ready) return [];
      return metrics
        .map((m) => {
          const metric = getMetricById(m);
          return {
            label: metric?.name,
            metric,
            rowClass: metric?.inverse ? "inverse" : "",
            variations: result.variations.map((v) => {
              return v.metrics[m];
            }),
          };
        })
        .filter((row) => row.metric);
    }, [results, ready]);
    rows.push(rowsArr[0]); // This feels hacky. I need to figure out a better way to do this.
  });

  rows.forEach((row, rowIndex) => {
    row.variations.forEach((variation, index) => {
      const updatedRow: UpdatedRow = {};
      if (results[rowIndex].name !== "All") {
        updatedRow[dimensionName.name] = results[rowIndex].name;
      }
      updatedRow.metricName = row.label;
      updatedRow.variantName = variations[index].name;
      const { relativeRisk } = getRisk(index, row);
      updatedRow.riskOfChoosing = relativeRisk;
      updatedRow.users = variation.users;
      updatedRow.count = variation.value;
      updatedRow.conversionRate = variation.cr;
      updatedRow.chanceToBeatControl = variation.chanceToWin || null;
      updatedRow.percentChange = variation.expected || null;
      csvRows.push(updatedRow);
    });
  });

  const csv = json2csvParser.parse(csvRows);

  const href = useMemo(() => {
    try {
      const blob = new Blob([csv], { type: "text/csv" });
      return window.URL.createObjectURL(blob);
    } catch (e) {
      console.error(e);
      return "";
    }
  }, []);

  if (!href) return null;

  return (
    <a
      type="button"
      className="dropdown-item py-2"
      href={href}
      download={`${trackingKey}.csv`}
    >
      <FaFileExport className="mr-2" /> Export CSV
    </a>
  );
}
