import { useMemo } from "react";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";

export default function ExplorerDataTable() {
  const { exploreData, submittedExploreState, loading, exploreError } =
    useExplorerContext();

  const dimensionColumnHeaders = useMemo(() => {
    const headers: string[] = [];
    for (const dimension of submittedExploreState?.dimensions || []) {
      if (dimension.dimensionType === "date") {
        headers.push("Date");
      } else if (dimension.dimensionType === "dynamic") {
        headers.push(dimension.column);
      } else {
        // TODO: Handle static and slice dimensions
        console.log("Unknown dimension type", dimension);
      }
    }
    if (headers.length === 0) {
      headers.push("Total");
    }
    return headers;
  }, [submittedExploreState?.dimensions]);

  const valueColumnHeaders = useMemo(() => {
    return submittedExploreState?.dataset?.values.map((v) => v.name) || [];
  }, [submittedExploreState?.dataset?.values]);

  const rowData = useMemo(() => {
    const rawRows = exploreData?.rows || [];
    const isTimeseries =
      submittedExploreState?.dimensions?.[0]?.dimensionType === "date";

    const rowsToProcess = isTimeseries
      ? [...rawRows].sort((a, b) => {
          const dateA = a.dimensions[0] || "";
          const dateB = b.dimensions[0] || "";
          if (!dateA || !dateB) return 0;
          return new Date(dateA).getTime() - new Date(dateB).getTime();
        })
      : rawRows;

    const numValues = valueColumnHeaders.length;
    const hasDenominatorAt: boolean[] = [];
    for (let i = 0; i < numValues; i++) {
      hasDenominatorAt[i] = rowsToProcess.some(
        (row) => row.values[i]?.denominator != null,
      );
    }

    // Build rows to pass to DisplayTestQueryResults
    const rows: Record<string, unknown>[] = [];
    for (const row of rowsToProcess) {
      const rowObject: Record<string, unknown> = {};

      // Add dimension values
      for (let i = 0; i < dimensionColumnHeaders.length; i++) {
        const dimension = row.dimensions[i];
        const columnName = dimensionColumnHeaders[i];

        if (dimension) {
          const currentDimension = submittedExploreState?.dimensions?.[i];
          if (currentDimension?.dimensionType === "date") {
            rowObject[columnName] = new Date(dimension).toLocaleDateString(
              undefined,
              {
                year: "numeric",
                month: "long",
                day: "numeric",
              },
            );
          } else {
            rowObject[columnName] = dimension;
          }
        } else if (dimensionColumnHeaders[0] === "Total") {
          rowObject[columnName] = "Total";
        } else {
          rowObject[columnName] = "";
        }
      }

      // Add value columns
      for (let i = 0; i < numValues; i++) {
        const value = row.values[i];
        const baseName = valueColumnHeaders[i];

        if (value?.numerator) {
          let val = value.numerator;
          if (value.denominator) {
            val /= value.denominator;
          }
          rowObject[baseName] = val.toFixed(2);
        } else {
          rowObject[baseName] = "";
        }

        if (hasDenominatorAt[i]) {
          if (value?.denominator != null) {
            rowObject["Value"] = value.numerator ?? "";
            rowObject["Units"] = value.denominator;
          } else {
            rowObject["Value"] = "";
            rowObject["Units"] = "";
          }
        }
      }

      rows.push(rowObject);
    }
    return rows;
  }, [
    exploreData?.rows,
    submittedExploreState?.dimensions,
    dimensionColumnHeaders,
    valueColumnHeaders,
  ]);

  if (loading) return null;
  if (!exploreData?.rows?.length && !exploreData?.sql) return null;

  return (
    <DisplayTestQueryResults
      results={rowData}
      duration={0}
      sql={exploreData?.sql || ""}
      error={exploreError || ""}
      allowDownload={true}
      showSampleHeader={false}
      showDuration={false}
    />
  );
}
