import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";
import React, { useMemo } from "react";
import { FaFileExport } from "react-icons/fa";
import { useDefinitions } from "../../services/DefinitionsContext";
import { ExperimentTableRow, getRisk } from "../../services/experiments";
import { Parser } from "json2csv";

type CsvRow = {
  date?: string;
  dimension?: string;
  metric?: string;
  variation?: string;
  riskOfChoosing?: number;
  users?: number;
  totalValue?: number;
  perUserValue?: number;
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

  const dimensionName =
    getDimensionById(dimension)?.name ||
    dimension?.split(":")?.[1] ||
    dimension ||
    null;

  const getRows = () => {
    const csvRows: CsvRow[] = [];

    if (!results || !variations || !ready) return [];

    const resultsCopy = [...results];

    if (dimension === "pre:date") {
      // Sort the rows by row.name to make csv cleaner
      resultsCopy.sort((a, b) => a.name.localeCompare(b.name));
    }

    resultsCopy.forEach((result) => {
      metrics.forEach((m) => {
        result.variations.forEach((variation, index) => {
          const metric = getMetricById(m);
          const row: ExperimentTableRow = {
            label: metric?.name,
            metric: metric,
            rowClass: metric?.inverse ? "inverse" : "",
            variations: result.variations.map((v) => {
              return v.metrics[m];
            }),
          };
          const stats = variation.metrics[m];
          if (!stats) return [];
          const { relativeRisk } = getRisk(index, row);
          csvRows.push({
            ...(dimensionName && { [dimensionName]: result.name }),
            metric: metric?.name,
            variation: variations[index].name,
            riskOfChoosing: relativeRisk,
            users: stats.users,
            totalValue: stats.value,
            perUserValue: stats.cr,
            chanceToBeatControl: stats.chanceToWin || null,
            percentChange: stats.expected || null,
          });
        });
      });
    });

    return csvRows;
  };

  const href = useMemo(() => {
    try {
      const rows = getRows();
      if (!rows) return "";

      const json2csvParser = new Parser();

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
      download={
        trackingKey
          ? `${trackingKey}${dimensionName ? `-${dimensionName}` : ""}.csv`
          : "results.csv"
      }
    >
      <FaFileExport className="mr-2" /> Export CSV
    </a>
  );
}
