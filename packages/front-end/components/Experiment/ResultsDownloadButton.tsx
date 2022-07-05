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
  variant?: string;
  riskOfChoosing?: number;
  users?: number;
  count?: number;
  value?: number;
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

    results.forEach((result) => {
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
          const { relativeRisk } = getRisk(index, row);
          csvRows.push({
            ...(result.name !== "All" && { [dimensionName]: result.name }),
            metric: metric?.name,
            variant: variations[index].name,
            riskOfChoosing: relativeRisk,
            users: variation.metrics[m].users,
            count: variation.metrics[m].value,
            value: variation.metrics[m].cr,
            chanceToBeatControl: variation.metrics[m].chanceToWin || null,
            percentChange: variation.metrics[m].expected || null,
          });
        });
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
