import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentReportResultDimension } from "back-end/types/report";
import React, { useMemo } from "react";
import { FaFileExport } from "react-icons/fa";
import { useDefinitions } from "../../services/DefinitionsContext";
import { ExperimentTableRow, getRisk } from "../../services/experiments";

type Row = {
  [key: string]: string;
};

export default function ResultsDownloadButton({
  results,
  experiment,
}: {
  results?: ExperimentReportResultDimension;
  experiment: ExperimentInterfaceStringDates;
}) {
  const { getMetricById, ready } = useDefinitions();

  // Get most of the data
  const csvRows = [];

  // First, get the variations
  const variations = experiment.variations.map((variant) => {
    return {
      name: variant.name,
      key: variant.key,
      relativeRisk: undefined,
    };
  });

  console.log("variations", variations);

  // Get the risk of choosing metric
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

  rows.map((row) => {
    // console.log(variations.length, row)
    row.variations.map((variation, variationIndex) => {
      const { relativeRisk } = getRisk(variationIndex, row);
      // console.log(`${variationIndex}relativeRisk`, relativeRisk);
      variations[variationIndex].relativeRisk = relativeRisk;
    });
  });

  console.log(variations);

  // Get all of the metrics by name.
  experiment.metrics.forEach((metricId) => {
    const row: Row = {};
    const metric = getMetricById(metricId);
    row.metricName = metric.name;

    //Now, loop through each variation of variations to get the specs
    variations.forEach((variant) => {
      // Now, get the results of the current variation
      const variationResults =
        results.variations[variant.key].metrics[metricId];
      // const { relativeRisk } = getRisk(i, variationResults);
      // console.log(relativeRisk);
      // console.log('variationResults', variationResults)
      row[`usersIn${variant.name}`] = variationResults.users;
      row[`countOf${variant.name}`] = variationResults.value;
      row[`conversionRateOf${variant.name}`] = variationResults.cr;
      row[`riskOfChoosing${variant.name}`] = variant.relativeRisk;

      if (variationResults.chanceToWin) {
        row[`chanceToWin`] = variationResults.chanceToWin;
      }
    });
    csvRows.push(row);
  });

  // Output that will ultimately be converted to CSV
  console.log("csvRows", csvRows);

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
