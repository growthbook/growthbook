import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";
import React, { useMemo } from "react";
import { FaFileExport } from "react-icons/fa";
import { useDefinitions } from "../../services/DefinitionsContext";
import { getRisk } from "../../services/experiments";
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

  const dimensionName =
    getDimensionById(dimension)?.name ||
    dimension?.split(":")?.[1] ||
    dimension ||
    null;

  const getRows = () => {
    const csvRows: CsvRow[] = [];

    const rows = [];
    if (!results || !variations || !ready) return [];

    results.forEach((result) => {
      metrics.forEach((m) => {
        const row: Row = {};
        const metric = getMetricById(m);
        row.label = metric?.name;
        row.metric = metric;
        if (result.name !== "All") {
          row[dimensionName] = result.name;
        }
        row.rowClass = metric?.inverse ? "inverse" : "";
        row.variations = result.variations.map((v) => {
          return v.metrics[m];
        });
        rows.push(row);
      });
    });

    rows.forEach((row) => {
      row.variations?.forEach((variation, index) => {
        const updatedRow: CsvRow = {};
        if (row[dimensionName]) {
          updatedRow[dimensionName] = row[dimensionName];
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

    return csvRows;
  };

  const href = useMemo(() => {
    try {
      const json2csvParser = new Parser();
      const rows = getRows();

      if (dimension === "pre:date") {
        // Sort the rows by row.date to make csv cleaner
        rows.sort((a, b) => a.date.localeCompare(b.date));
      }

      const csv = json2csvParser.parse(rows);

      const blob = new Blob([csv], { type: "text/csv" });
      return window.URL.createObjectURL(blob);
    } catch (e) {
      console.error(e);
      return "";
    }
  }, [results, ready, variations, dimension]);

  if (!href) return null;

  return (
    <a
      type="button"
      className="dropdown-item py-2"
      href={href}
      download={`${trackingKey}${dimensionName ? `-${dimensionName}` : ""}.csv`}
    >
      <FaFileExport className="mr-2" /> Export CSV
    </a>
  );
}
