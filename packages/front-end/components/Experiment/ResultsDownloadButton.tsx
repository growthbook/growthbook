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
  metricName: string;
  variantName: string;
  riskOfChoosing: number;
  users: number;
  count: number;
  conversionRate: number;
  changeToBeatControl: number | null;
  percentChange: number | null;
};

export default function ResultsDownloadButton({
  results,
  metrics,
  variations,
  trackingKey,
}: {
  results?: ExperimentReportResultDimension;
  metrics: string[];
  variations: ExperimentReportVariation[];
  trackingKey: string;
}) {
  const { getMetricById, ready } = useDefinitions();
  const headers = [
    "metricName",
    "variationName",
    "riskOfChoosing",
    "users",
    "count",
    "conversionRate",
    "chanceToBeatControl",
    "percentChange",
  ];
  const json2csvParser = new Parser({ headers });

  const csvRows = [];

  const rows = useMemo<ExperimentTableRow[]>(() => {
    if (!results || !results.variations || !ready) return [];
    return metrics
      .map((row) => {
        const metric = getMetricById(row);
        return {
          label: metric?.name,
          metric,
          rowClass: metric?.inverse ? "inverse" : "",
          variations: results.variations.map((variant) => {
            return variant.metrics[row];
          }),
        };
      })
      .filter((row) => row.metric);
  }, [results, ready]);

  console.log("rows", rows);

  rows.forEach((row) => {
    row.variations.forEach((variant, index) => {
      variant.name = variations[index].name;
      const { relativeRisk } = getRisk(index, row);
      variant.relativeRisk = relativeRisk;
    });
  });

  rows.forEach((row) => {
    row.variations.forEach((variant) => {
      const updatedRow: UpdatedRow = {};
      updatedRow.metricName = row.metric.name;
      updatedRow.variantName = variant.name;
      updatedRow.riskOfChoosing = variant.relativeRisk;
      updatedRow.users = variant.users;
      updatedRow.count = variant.value;
      updatedRow.conversionRate = variant.cr;
      updatedRow.changeToBeatControl = variant.chanceToWin || null;
      updatedRow.percentChange = variant.expected || null;

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
