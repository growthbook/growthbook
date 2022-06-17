import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentReportResultDimension } from "back-end/types/report";
import React, { useMemo } from "react";
import { FaFileExport } from "react-icons/fa";
import { useDefinitions } from "../../services/DefinitionsContext";
import { ExperimentTableRow, getRisk } from "../../services/experiments";

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
      .map((m) => {
        const metric = getMetricById(m);
        return {
          label: metric?.name,
          metric,
          rowClass: metric?.inverse ? "inverse" : "",
          variations: results.variations.map((v) => {
            return v.metrics[m];
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
    const updatedRow = {};
    const metric = getMetricById(row.metric.id);
    updatedRow.metricName = metric.name;

    row.variations.forEach((variation) => {
      updatedRow[`usersIn${variation.name}`] = variation.users;
      updatedRow[`countOf${variation.name}`] = variation.value;
      updatedRow[`conversionRateOf${variation.name}`] = variation.cr;
      updatedRow[`riskOfChoosing${variation.name}`] = variation.relativeRisk;

      if (variation.chanceToWin) {
        updatedRow[`chanceToBeatControl`] = variation.chanceToWin;
      }
    });

    csvRows.push(updatedRow);
  });

  function generateCsv(data) {
    const csvRows = [];
    const headers = Object.keys(data[0]);
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
