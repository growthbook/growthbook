import { FaExclamationTriangle } from "react-icons/fa";
import { PiArrowLineDownThin, PiCaretLeft, PiCaretRight } from "react-icons/pi";
import { Flex, Separator } from "@radix-ui/themes";
import { useRef, useState } from "react";
import Code from "@/components/SyntaxHighlighting/Code";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import { convertToCSV, downloadCSVFile } from "@/services/sql";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import { AreaWithHeader } from "@/components/SchemaBrowser/SqlExplorerModal";

export type Props = {
  results: Record<string, unknown>[];
  duration: number;
  sql: string;
  error: string;
  close?: () => void;
  expandable?: boolean;
  allowDownload?: boolean;
  showSampleHeader?: boolean;
  renderedSQLLabel?: string;
  showDuration?: boolean;
};

export default function DisplayTestQueryResults({
  results,
  duration,
  sql,
  error,
  close,
  expandable,
  allowDownload,
  showSampleHeader = true,
  renderedSQLLabel = "Rendered SQL",
  showDuration = true,
}: Props) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const cols = Object.keys(results?.[0] || {});

  const forceShowSql = error || !results.length;

  const [page, setPage] = useState(1);
  const pageSize = 100;
  const totalPages = Math.ceil(results.length / pageSize);

  const tableBodyScrollRef = useRef<HTMLDivElement>(null);

  // Match the line number from the error message that
  // either has "line <line number>" in it,
  // or ends with "[<line number>:<col number>]"
  const errorLineMatch = error.match(/line\s+(\d+)|\[(\d+):\d+\]$/i);
  const errorLine = errorLineMatch
    ? Number(errorLineMatch[1] || errorLineMatch[2])
    : undefined;

  function handleDownload(results: Record<string, unknown>[]) {
    const csv = convertToCSV(results);
    if (!csv) {
      throw new Error(
        "Error downloading results. Reason: Unable to convert results to CSV.",
      );
    }
    downloadCSVFile(csv);
  }

  return (
    <Tabs
      defaultValue={forceShowSql ? "sql" : "results"}
      style={{
        overflow: "hidden",
        height: "100%",
      }}
    >
      <AreaWithHeader
        headerStyles={{
          paddingLeft: "12px",
          paddingRight: "12px",
        }}
        header={
          <TabsList>
            {!forceShowSql && (
              <TabsTrigger value="results">Results</TabsTrigger>
            )}
            <TabsTrigger value="sql">{renderedSQLLabel}</TabsTrigger>
            <div className="flex-grow-1">
              {close ? (
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
              ) : null}
            </div>
          </TabsList>
        }
      >
        {!forceShowSql && (
          <TabsContent
            value="results"
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              paddingLeft: "12px",
              paddingRight: "12px",
            }}
          >
            <div className="mt-2 rounded p-2 bg-light">
              {downloadError ? (
                <div className="mb-2">
                  <Callout status="error">{downloadError}</Callout>
                </div>
              ) : null}
              <Flex align="center" gap="4">
                <Flex align="center" flexGrow={"1"}>
                  {showDuration && (
                    <span className="font-weight-light pl-2">
                      Succeeded in {duration}ms
                    </span>
                  )}
                </Flex>
                {totalPages > 1 ? (
                  <Flex align="center">
                    <div className="mr-1">
                      Showing {page * pageSize - pageSize + 1} -{" "}
                      {Math.min(page * pageSize, results.length)} of{" "}
                      <Tooltip
                        body={"GrowthBook limits the result to 1,000 rows max"}
                        shouldDisplay={results.length >= 1000}
                      >
                        <strong>{results.length}</strong> rows
                      </Tooltip>
                    </div>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={page <= 1}
                      onClick={() => {
                        setPage((p) => Math.max(p - 1, 1));
                        // Scroll to top
                        tableBodyScrollRef.current?.scrollTo({
                          top: 0,
                          behavior: "instant",
                        });
                      }}
                    >
                      <PiCaretLeft size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={page >= totalPages}
                      onClick={() => {
                        setPage((p) => Math.min(p + 1, totalPages));
                        // Scroll to top
                        tableBodyScrollRef.current?.scrollTo({
                          top: 0,
                          behavior: "instant",
                        });
                      }}
                    >
                      <PiCaretRight size={16} />
                    </Button>
                  </Flex>
                ) : (
                  <Flex align="center">
                    <strong className="pr-1">
                      {showSampleHeader ? "Sample " : ""}
                      {results?.length} Rows
                    </strong>
                  </Flex>
                )}
                {allowDownload ? (
                  <>
                    <Separator orientation="vertical" />
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!results.length}
                      onClick={() => handleDownload(results)}
                      setError={setDownloadError}
                    >
                      <PiArrowLineDownThin size={16} /> Download CSV
                    </Button>
                  </>
                ) : null}
              </Flex>
            </div>
            <div
              style={{ width: "100%", overflow: "auto", flexGrow: 1 }}
              className="mb-3"
              ref={tableBodyScrollRef}
            >
              <table className="table table-bordered appbox gbtable table-hover mb-0">
                <thead
                  style={{
                    position: "sticky",
                    top: -1,
                    zIndex: 2,
                    backgroundColor: "var(--color-panel-solid)",
                  }}
                >
                  <tr>
                    {cols.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results
                    .slice((page - 1) * pageSize, page * pageSize)
                    .map((result, i) => (
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
          <div
            style={{
              overflowY: "auto",
              height: "100%",
              paddingLeft: "12px",
              paddingRight: "12px",
            }}
            className="mt-3"
          >
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
      </AreaWithHeader>
    </Tabs>
  );
}
