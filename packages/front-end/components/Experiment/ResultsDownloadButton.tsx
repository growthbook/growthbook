import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";
import React, { useMemo } from "react";
import { FaFileExport } from "react-icons/fa";
import { useDefinitions } from "../../services/DefinitionsContext";
import { ExperimentTableRow, getRisk } from "../../services/experiments";
import { Parser } from "json2csv";
import { MetricInterface, MetricStats } from "back-end/types/metric";

type CsvRow = {
  date?: string;
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

type Variation = {
  buckets?: { x: number; y: number }[];
  ci?: [number, number];
  cr: number;
  risk?: [number, number];
  stats?: MetricStats;
  users: number;
  value: number;
};

type Row = {
  label?: string;
  metric?: MetricInterface;
  rowClass?: string;
  variations?: Variation[];
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

  const csvRows: CsvRow[] = [];

  const dimensionName = getDimensionById(dimension);

  if (dimension === "pre:date") {
    results.sort((a, b) => (a.name > b.name ? 1 : b.name > a.name ? -1 : 0));
  }

  const rows = useMemo<ExperimentTableRow[]>(() => {
    const rowsArr = [];
    if (!results || !variations || !ready) return [];
    results.forEach((result) => {
      metrics.forEach((m) => {
        const row: Row = {};
        const metric = getMetricById(m);
        (row.label = metric?.name),
          (row.metric = metric),
          (row.rowClass = metric?.inverse ? "inverse" : ""),
          (row.variations = result.variations.map((v) => {
            return v.metrics[m];
          })),
          rowsArr.push(row);
      });
    });
    return rowsArr;
  }, [results, ready, variations]);

  rows.forEach((row, rowIndex) => {
    row.variations.forEach((variation, index) => {
      const updatedRow: CsvRow = {};
      if (dimension === "pre:date") {
        updatedRow.date = results[rowIndex].name;
      } else if (results[rowIndex].name !== "All") {
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
  }, [csv]);

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
