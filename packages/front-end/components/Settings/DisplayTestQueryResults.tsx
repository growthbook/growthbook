import { FaCheck, FaExclamationTriangle } from "react-icons/fa";
import { TestQueryRow } from "back-end/src/types/Integration";
import { Flex } from "@radix-ui/themes";
import Code from "@/components/SyntaxHighlighting/Code";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/Radix/Tabs";
import Button from "../Radix/Button";

export type Props = {
  results: Record<string, unknown>[];
  duration: number;
  sql: string;
  error: string;
  close: () => void;
  expandable?: boolean;
  allowDownloads?: boolean;
  header?: string;
  dismissable?: boolean;
};

export default function DisplayTestQueryResults({
  results,
  duration,
  sql,
  error,
  close,
  expandable,
  allowDownloads = false,
  header,
  dismissable = true,
}: Props) {
  const cols = Object.keys(results?.[0] || {});

  const forceShowSql = error || !results.length;

  // Match the line number from the error message that
  // either has "line <line number>" in it,
  // or ends with "[<line number>:<col number>]"
  const errorLineMatch = error.match(/line\s+(\d+)|\[(\d+):\d+\]$/i);
  const errorLine = errorLineMatch
    ? Number(errorLineMatch[1] || errorLineMatch[2])
    : undefined;

  function convertToCSV(rows: TestQueryRow[]): string {
    if (!rows.length) return "";

    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","), // header row
      ...rows.map((row) =>
        headers
          .map((field) => {
            const value = row[field];
            if (value == null) return ""; // null or undefined

            // Handle arrays
            if (Array.isArray(value)) {
              const arrayStr = value
                .map((item) => {
                  if (typeof item === "object" && item !== null) {
                    return JSON.stringify(item);
                  }
                  return String(item);
                })
                .join(";");
              return `"${arrayStr}"`;
            }

            // Handle objects (including JSON/JSONB, nested objects, and geographic data)
            if (typeof value === "object" && value !== null) {
              return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
            }

            // Handle dates and timestamps
            if (value instanceof Date) {
              return `"${value.toISOString()}"`;
            }

            // Handle booleans
            if (typeof value === "boolean") {
              return `"${value}"`;
            }

            // Handle numbers (including BigInt)
            if (typeof value === "number" || typeof value === "bigint") {
              return `"${value}"`;
            }

            // Handle binary data (convert to base64)
            if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
              const binaryStr = btoa(
                String.fromCharCode.apply(null, new Uint8Array(value))
              );
              return `"${binaryStr}"`;
            }

            // Default case: handle as string
            const escaped = String(value).replace(/"/g, '""'); // escape double quotes
            return `"${escaped}"`; // quote everything
          })
          .join(",")
      ),
    ].join("\n");

    return csv;
  }

  function downloadCSVFile(csv: string, filename: string = "results.csv") {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleDownload() {
    const csv = convertToCSV(results);
    if (!csv) {
      alert("No data to export.");
      return;
    }
    downloadCSVFile(csv);
  }

  return (
    <Tabs
      defaultValue={forceShowSql ? "sql" : "results"}
      style={{ maxHeight: "50%", overflow: "hidden" }}
    >
      <TabsList>
        {!forceShowSql && <TabsTrigger value="results">Results</TabsTrigger>}
        <TabsTrigger value="sql">Rendered SQL</TabsTrigger>
        {dismissable ? (
          <div className="flex-grow-1">
            <button
              type="button"
              className="close"
              style={{ padding: "0.3rem 1rem" }}
              onClick={(e) => {
                e.preventDefault();
                close();
              }}
              aria-label="Close"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ) : null}
      </TabsList>

      {!forceShowSql && (
        <TabsContent
          value="results"
          style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
          {allowDownloads ? (
            <Flex className="pt-2" justify="end">
              <Button onClick={() => handleDownload()}>Download CSV</Button>
            </Flex>
          ) : null}

          <div className="border mt-2 rounded p-2 bg-light">
            <div className="row">
              <div className="col-auto">
                <strong>{header || `Sample ${results?.length} Rows`}</strong>
              </div>
              <div className="col-auto ml-auto">
                <div className="text-success">
                  <FaCheck />
                  <span className="pl-2">Succeeded in {duration}ms</span>
                </div>
              </div>
            </div>
          </div>
          <div
            style={{ width: "100%", overflow: "auto", flexGrow: 1 }}
            className="mb-3"
          >
            <table
              className="table table-bordered table-sm appbox w-100 mb-0"
              style={{ position: "relative" }}
            >
              <thead
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 2,
                  background: "white",
                }}
              >
                <tr>
                  {cols.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((result, i) => (
                  <tr key={i}>
                    {Object.values(result).map((val, j) => (
                      <td key={j}>{JSON.stringify(val)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      )}

      <TabsContent
        value="sql"
        style={{ display: "flex", flexDirection: "column", height: "100%" }}
      >
        <div style={{ overflowY: "auto", height: "100%" }}>
          {error ? (
            <div className="alert alert-danger mr-auto">{error}</div>
          ) : (
            !results.length && (
              <div className="alert alert-warning mr-auto">
                <FaExclamationTriangle /> No rows returned, could not verify
                result
              </div>
            )
          )}
          <Code
            code={sql}
            language="sql"
            errorLine={errorLine}
            expandable={expandable}
          />
        </div>
      </TabsContent>
    </Tabs>
  );
}
