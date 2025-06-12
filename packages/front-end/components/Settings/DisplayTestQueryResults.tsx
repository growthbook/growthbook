import { FaExclamationTriangle } from "react-icons/fa";
import { PiArrowLineDownThin, PiInfo } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { useState } from "react";
import Code from "@/components/SyntaxHighlighting/Code";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/Radix/Tabs";
import { convertToCSV, downloadCSVFile } from "@/services/sql";
import Button from "../Radix/Button";
import Tooltip from "../Tooltip/Tooltip";
import Callout from "../Radix/Callout";
import { AreaWithHeader } from "../SchemaBrowser/SqlExplorerModal";

export type Props = {
  results: Record<string, unknown>[];
  duration: number;
  sql: string;
  error: string;
  close?: () => void;
  expandable?: boolean;
  allowDownload?: boolean;
};

export default function DisplayTestQueryResults({
  results,
  duration,
  sql,
  error,
  close,
  expandable,
  allowDownload,
}: Props) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const cols = Object.keys(results?.[0] || {});

  const forceShowSql = error || !results.length;

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
        "Error downloading results. Reason: Unable to convert results to CSV."
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
        headerStyles={{}}
        header={
          <TabsList>
            {!forceShowSql && (
              <TabsTrigger value="results">Results</TabsTrigger>
            )}
            <TabsTrigger value="sql">Rendered SQL</TabsTrigger>
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
            style={{ display: "flex", flexDirection: "column", height: "100%" }}
          >
            <div className="mt-2 rounded p-2 bg-light">
              {downloadError ? (
                <div className="mb-2">
                  <Callout status="error">{downloadError}</Callout>
                </div>
              ) : null}
              <Flex align="center" justify="between">
                <Flex align="center">
                  <strong className="pr-1">
                    Sample {results?.length} Rows
                  </strong>
                  {results.length === 1000 ? (
                    <Tooltip
                      body={
                        "GrowthBook automatically limits the results to 1,000 rows"
                      }
                    >
                      <PiInfo
                        size={16}
                        className="mb-1"
                        style={{ color: "var(--violet-11)" }}
                      />
                    </Tooltip>
                  ) : null}
                  <span className="font-weight-light pl-2">
                    Succeeded in {duration}ms
                  </span>
                </Flex>
                {allowDownload ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={!results.length}
                    onClick={() => handleDownload(results)}
                    setError={setDownloadError}
                  >
                    <PiArrowLineDownThin size={16} /> Download CSV
                  </Button>
                ) : null}
              </Flex>
            </div>
            <div
              style={{ width: "100%", overflow: "auto", flexGrow: 1 }}
              className="mb-3"
            >
              <table className="table table-bordered appbox gbtable table-hover mb-0">
                <thead
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
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
      </AreaWithHeader>
    </Tabs>
  );
}
