import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "shared/types/report";
import React, { useCallback, useMemo } from "react";
import { FaFileExport } from "react-icons/fa";
import { Parser } from "json2csv";
import { useDefinitions } from "@/services/DefinitionsContext";

type CsvRow = {
  date?: string;
  dimension?: string;
  metric?: string;
  variation?: string;
  riskOfChoosing?: number;
  users?: number;
  totalValue?: number;
  perUserValue?: number;
  perUserValueStdDev?: number | null;
  chanceToBeatControl?: number | null;
  percentChange?: number | null;
  percentChangePValue?: number | null;
  percentChangePValueAdjusted?: number | null;
  percentChangeCILower?: number | null;
  percentChangeCIUpper?: number | null;
  percentChangeCILowerAdjusted?: number | null;
  percentChangeCIUpperAdjusted?: number | null;
};

export default function ResultsDownloadButton({
  results,
  metrics,
  variations,
  trackingKey,
  dimension,
  noIcon,
}: {
  results: ExperimentReportResultDimension[];
  metrics?: string[];
  variations?: ExperimentReportVariation[];
  trackingKey?: string;
  dimension?: string;
  noIcon?: boolean;
}) {
  const { getExperimentMetricById, getDimensionById, ready } = useDefinitions();

  const dimensionName = dimension
    ? getDimensionById(dimension)?.name ||
      dimension?.split(":")?.[1] ||
      dimension
    : null;

  const getRows = useCallback(() => {
    const csvRows: CsvRow[] = [];

    if (!variations || !ready) return [];

    const resultsCopy = [...results];

    if (dimension?.substring(0, 8) === "pre:date") {
      // Sort the results by date to make csv cleaner
      resultsCopy.sort((a, b) => a.name.localeCompare(b.name));
    }

    resultsCopy.forEach((result) => {
      metrics?.forEach((metricId) => {
        result.variations.forEach((variation, index) => {
          const stats = variation.metrics[metricId];
          if (!stats) return;

          // Get metric name from the metric ID
          // For slice metrics, extract the base name and slice info
          let metricName = metricId;
          if (metricId.includes("?")) {
            const baseMetricId = metricId.split("?")[0];
            const baseMetric = getExperimentMetricById(baseMetricId);
            if (baseMetric) {
              // Extract slice info from the query string
              const queryString = metricId.split("?")[1];
              const params = new URLSearchParams(queryString);
              const sliceParts: string[] = [];
              for (const [key, value] of params.entries()) {
                if (key.startsWith("dim:")) {
                  const column = decodeURIComponent(key.substring(4));
                  const level =
                    value === "" ? "other" : decodeURIComponent(value);
                  sliceParts.push(`${column}: ${level}`);
                }
              }
              metricName = `${baseMetric.name} (${sliceParts.join(", ")})`;
            }
          } else {
            const metric = getExperimentMetricById(metricId);
            if (metric) {
              metricName = metric.name;
            }
          }

          csvRows.push({
            ...(dimensionName && { [dimensionName]: result.name }),
            metric: metricName,
            variation: variations[index].name,
            riskOfChoosing: 0,
            users: stats.users,
            totalValue: stats.value,
            perUserValue: stats.cr,
            perUserValueStdDev: stats.stats?.stddev || null,
            chanceToBeatControl: stats.chanceToWin ?? null,
            percentChange: stats.expected || null,
            percentChangePValue: stats.pValue ?? null,
            percentChangePValueAdjusted: stats.pValueAdjusted ?? null,
            percentChangeCILower: stats.ci?.[0] || null,
            percentChangeCIUpper: stats.ci?.[1] || null,
            percentChangeCILowerAdjusted: stats.ciAdjusted?.[0] ?? null,
            percentChangeCIUpperAdjusted: stats.ciAdjusted?.[1] ?? null,
          });
        });
      });
    });
    return csvRows;
  }, [
    dimension,
    dimensionName,
    getExperimentMetricById,
    metrics,
    ready,
    results,
    variations,
  ]);

  const href = useMemo(() => {
    try {
      const rows = getRows();
      if (!rows || rows?.length < 1) return "";

      const json2csvParser = new Parser();
      const csv = json2csvParser.parse(rows);

      const blob = new Blob([csv], { type: "text/csv" });
      return window.URL.createObjectURL(blob);
    } catch (e) {
      console.error(e);
      return "";
    }
  }, [getRows]);

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
      {!noIcon ? (
        <>
          <FaFileExport className="mr-2" />{" "}
        </>
      ) : null}
      Export CSV
    </a>
  );
}
