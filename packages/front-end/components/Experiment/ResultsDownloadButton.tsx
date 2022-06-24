import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentReportResultDimension } from "back-end/types/report";
import React, { useMemo } from "react";
import { FaFileExport } from "react-icons/fa";
import { useDefinitions } from "../../services/DefinitionsContext";
import { ExperimentTableRow, getRisk } from "../../services/experiments";

type UpdatedRow = {
  metricName?: string;
};

export default function ResultsDownloadButton({
  results,
  experiment,
}: {
  results?: ExperimentReportResultDimension;
  experiment: ExperimentInterfaceStringDates;
}) {
  const { getMetricById, ready } = useDefinitions();

  const csvRows = [];

  const rows = useMemo<ExperimentTableRow[]>(() => {
    if (!results || !results.variations || !ready) return [];
    return experiment.metrics
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

  rows.forEach((row) => {
    row.variations.forEach((variant, index) => {
      variant.name = experiment.variations[index].name;
      const { relativeRisk } = getRisk(index, row);
      variant.relativeRisk = relativeRisk;
    });
  });

  rows.forEach((row) => {
    const updatedRow: UpdatedRow = {};
    updatedRow.metricName = row.metric.name;

    row.variations.forEach((variant) => {
      updatedRow[`usersIn${variant.name}`] = variant.users;
      updatedRow[`countOf${variant.name}`] = variant.value;
      updatedRow[`conversionRateOf${variant.name}`] = variant.cr;
      updatedRow[`riskOfChoosing${variant.name}`] = variant.relativeRisk;

      if (variant.chanceToWin) {
        updatedRow[`chanceToBeatControl`] = variant.chanceToWin;
      }

      if (variant.expected) {
        updatedRow[`percentChangeOf${variant.name}`] = variant.expected;
      }
    });

    csvRows.push(updatedRow);
  });

  function generateCsv(data) {
    const csvRows = [];
    // Here I need to sort the data[0] keys so 'metricName" is first, with the rest of the keys being in alpha-numeric order
    const headers = Object.keys(data[0]);

    headers.sort();

    headers.forEach((header, i) => {
      if (header === "metricName") {
        headers.splice(i, 1);
      }
    });

    headers.unshift("metricName");

    csvRows.push(headers.join(","));

    for (const row of data) {
      const values = headers.map((header) => {
        const formattedValues = ("" + row[header]).replace(/"/g, '\\"');
        return `"${formattedValues}"`;
      });
      csvRows.push(values.join(","));
    }
    return csvRows.join("\n");
  }

  const href = useMemo(() => {
    try {
      const csv = generateCsv(csvRows);
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
      download={`${experiment.trackingKey}.csv`}
    >
      <FaFileExport className="mr-2" /> Export CSV
    </a>
  );
}
