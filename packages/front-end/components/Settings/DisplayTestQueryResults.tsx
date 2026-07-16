import { PiArrowLineDownThin, PiCaretLeft, PiCaretRight } from "react-icons/pi";
import { Flex, Separator } from "@radix-ui/themes";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { isManagedWarehousePendingQueryError } from "shared/util";
import Code from "@/components/SyntaxHighlighting/Code";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import { convertToCSV, downloadCSVFile } from "@/services/sql";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import { AreaWithHeader } from "@/components/SchemaBrowser/SqlExplorerModal";
import { floatRound } from "@/services/utils";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import {
  flattenHeaderStructureForCsv,
  type HeaderStructure,
} from "@/components/Settings/flattenHeaderStructureForCsv";

export type { HeaderStructure };

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
  headerStructure?: HeaderStructure;
  orderedColumnKeys?: string[];
  /**
   * Display labels aligned with `orderedColumnKeys`. When omitted, the keys
   * themselves are used as labels (back-compat for existing callers that
   * pass human-readable keys).
   */
  columnLabels?: string[];
  /**
   * When set, CSV export includes only these keys (in order). Use to omit
   * synthetic columns such as compare trend payloads.
   */
  csvColumnKeys?: string[];
  /** Headers for CSV columns; must align 1:1 with `csvColumnKeys`. */
  csvColumnLabels?: string[];
  /**
   * Custom cell renderer. Return `undefined` or `null` to fall back to the
   * default string rendering for that cell.
   */
  renderCell?: (
    key: string,
    value: unknown,
    row: Record<string, unknown>,
  ) => ReactNode | undefined;
  paddingTop?: number;
  showNoRowsWarning?: boolean;
  hideSql?: boolean;
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
  headerStructure,
  orderedColumnKeys,
  columnLabels,
  csvColumnKeys,
  csvColumnLabels,
  renderCell,
  paddingTop = 0,
  showNoRowsWarning = true,
  hideSql = false,
}: Props) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const cols = orderedColumnKeys ?? Object.keys(results?.[0] || {});
  const labels = columnLabels ?? cols;
  const useTwoRowHeader = headerStructure != null && orderedColumnKeys != null;

  const forceShowSql = !hideSql && (error || !results.length);

  const [page, setPage] = useState(1);
  const pageSize = 100;
  const totalPages = Math.ceil(results.length / pageSize);

  const tableBodyScrollRef = useRef<HTMLDivElement>(null);

  // Match the line number from the error message that
  // either has "line <line number>" in it,
  // or ends with "[<line number>:<col number>]"
  const errorLineMatch =
    !isManagedWarehousePendingQueryError(error) &&
    error.match(/line\s+(\d+)|\[(\d+):\d+\]$/i);
  const errorLine = errorLineMatch
    ? Number(errorLineMatch[1] || errorLineMatch[2])
    : undefined;

  function defaultCellContent(value: unknown): string {
    if (value == null) return "";
    if (typeof value === "number") {
      return value.toLocaleString();
    }
    if (typeof value === "string" || typeof value === "boolean") {
      return String(value);
    }
    return JSON.stringify(value);
  }

  function handleDownload(rows: Record<string, unknown>[]) {
    const keys = csvColumnKeys ?? orderedColumnKeys;

    const labelsForCsv = ((): string[] | undefined => {
      if (!keys?.length) return undefined;
      if (csvColumnLabels && csvColumnLabels.length === keys.length) {
        return csvColumnLabels;
      }
      if (
        headerStructure &&
        orderedColumnKeys &&
        orderedColumnKeys.length === keys.length
      ) {
        const flat = flattenHeaderStructureForCsv(headerStructure);
        if (flat.length === keys.length) {
          return flat;
        }
      }
      if (columnLabels && columnLabels.length === keys.length) {
        return columnLabels;
      }
      return undefined;
    })();

    const rowsForCsv =
      keys?.length && labelsForCsv && keys.length === labelsForCsv.length
        ? rows.map((row) =>
            Object.fromEntries(
              keys.map((key, i) => [labelsForCsv[i] ?? key, row[key] ?? ""]),
            ),
          )
        : columnLabels && orderedColumnKeys
          ? rows.map((row) =>
              Object.fromEntries(
                orderedColumnKeys.map((key, i) => [
                  columnLabels[i] ?? key,
                  row[key],
                ]),
              ),
            )
          : rows;
    const csv = convertToCSV(rowsForCsv);
    if (!csv) {
      throw new Error(
        "Error downloading results. Reason: Unable to convert results to CSV.",
      );
    }
    downloadCSVFile(csv);
  }

  return (
    <Tabs
      key={forceShowSql ? "sql" : "results"}
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
          paddingTop: `${paddingTop}px`,
        }}
        header={
          <TabsList>
            {!forceShowSql && (
              <TabsTrigger value="results">Results</TabsTrigger>
            )}
            {!hideSql && (
              <TabsTrigger value="sql">{renderedSQLLabel}</TabsTrigger>
            )}
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
                      Succeeded in {floatRound(duration, 2)}ms
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
                  {useTwoRowHeader && headerStructure ? (
                    <>
                      <tr>
                        {headerStructure.row1.map((cell, idx) => (
                          <th
                            key={idx}
                            rowSpan={cell.rowSpan}
                            colSpan={cell.colSpan ?? 1}
                            style={{ minWidth: 150 }}
                          >
                            {cell.label}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {headerStructure.row2Labels.map((label, idx) => (
                          <th key={idx} style={{ minWidth: 150 }}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </>
                  ) : (
                    <tr>
                      {cols.map((col, i) => (
                        <th key={col} style={{ minWidth: 150 }}>
                          {labels[i] ?? col}
                        </th>
                      ))}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {results
                    .slice((page - 1) * pageSize, page * pageSize)
                    .map((result, i) => (
                      <tr key={i}>
                        {cols.map((key, j) => {
                          const raw = result[key];
                          const custom = renderCell?.(key, raw, result);
                          return (
                            <td key={j}>
                              {custom !== undefined && custom !== null
                                ? custom
                                : defaultCellContent(raw)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        )}

        {!hideSql && (
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
                isManagedWarehousePendingQueryError(error) ? (
                  <div className="mb-3 mr-auto" style={{ maxWidth: 720 }}>
                    <ManagedWarehouseNoEventsCallout />
                  </div>
                ) : (
                  <Callout status="error" mr="auto">
                    {error}
                  </Callout>
                )
              ) : (
                showNoRowsWarning &&
                !results.length && (
                  <Callout status="warning" mr="auto">
                    No rows returned, could not verify result
                  </Callout>
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
        )}
      </AreaWithHeader>
    </Tabs>
  );
}
