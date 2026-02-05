import { useMemo } from "react";
import { Box, Text } from "@radix-ui/themes";
import { useExplorerContext } from "../ExplorerContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Code from "@/components/SyntaxHighlighting/Code";
import { AreaWithHeader } from "@/components/SchemaBrowser/SqlExplorerModal";

export default function ExplorerDataTable() {
  const { exploreData, submittedExploreState } = useExplorerContext();

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
    return headers;
  }, [submittedExploreState?.dimensions]);

  const valueColumnHeaders = useMemo(() => {
    return submittedExploreState?.dataset?.values.map((v) => v.name) || [];
  }, [submittedExploreState?.dataset?.values]);

  const rowData = useMemo(() => {
    const rows: string[][] = [];
    for (const row of exploreData?.rows || []) {
      const tempRow: string[] = [];
      for (let i = 0; i < dimensionColumnHeaders.length; i++) {
        const dimension = row.dimensions[i];
        if (dimension) {
          if (i === 0 && submittedExploreState?.chartType === "line") {
            tempRow.push(
              new Date(dimension).toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              }),
            );
          } else {
            tempRow.push(dimension);
          }
        }
      }
      const missingDims = dimensionColumnHeaders.length - tempRow.length;
      for (let i = 0; i < missingDims; i++) {
        tempRow.push("");
      }
      for (const value of row.values) {
        if (value?.numerator) {
          tempRow.push(value.numerator.toString());
        } else {
          tempRow.push("");
        }
      }
      rows.push(tempRow);
    }
    return rows;
  }, [exploreData?.rows]);

  if (!exploreData?.rows?.length && !exploreData?.sql) return null;

  return (
    <Tabs defaultValue={exploreData?.rows?.length ? "results" : "sql"}>
      <AreaWithHeader
        header={
          <TabsList>
            <TabsTrigger value="results" disabled={rowData.length === 0}>
              Results
            </TabsTrigger>
            <TabsTrigger value="sql">Rendered SQL</TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value="results">
          <Box
            style={{
              border: "1px solid var(--gray-a3)",
              borderRadius: "var(--radius-4)",
              overflow: "hidden",
              maxHeight: "400px",
              overflowY: "auto",
            }}
          >
            <table className="table gbtable mb-0">
              <thead
                style={{
                  position: "sticky",
                  top: 0,
                  backgroundColor: "var(--color-background)",
                  zIndex: 1,
                }}
              >
                <tr>
                  {dimensionColumnHeaders.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                  {valueColumnHeaders.map((h, i) => (
                    <th key={i} style={{ textAlign: "right" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowData.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) =>
                      j < dimensionColumnHeaders.length ? (
                        <td key={j}>{cell}</td>
                      ) : (
                        <td key={j} style={{ textAlign: "right" }}>
                          {cell}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        </TabsContent>

        <TabsContent value="sql">
          <Box p="3">
            {exploreData?.sql ? (
              <Code code={exploreData.sql} language="sql" expandable />
            ) : (
              <div className="text-muted">No SQL query available</div>
            )}
          </Box>
        </TabsContent>
      </AreaWithHeader>
    </Tabs>
  );
}
