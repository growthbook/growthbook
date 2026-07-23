import { PiCaretLeft, PiCaretRight, PiTimer } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Flex, IconButton } from "@radix-ui/themes";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { isManagedWarehousePendingQueryError } from "shared/util";
import Code from "@/components/SyntaxHighlighting/Code";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import { convertToCSV, downloadCSVFile } from "@/services/sql";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import AreaWithHeader from "@/components/SchemaBrowser/AreaWithHeader";
import QueryModal from "@/components/Experiment/QueryModal";
import { floatRound } from "@/services/utils";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import {
  flattenHeaderStructureForCsv,
  type HeaderStructure,
} from "@/components/Settings/flattenHeaderStructureForCsv";

export type { HeaderStructure };

export type AdditionalQueryResultsTab = {
  value: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
};

export type Props = {
  results: Record<string, unknown>[];
  duration: number;
  sql: string;
  error: string;
  close?: () => void;
  expandable?: boolean;
  allowDownload?: boolean;
  showSampleHeader?: boolean;
  rowsLabel?: string;
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
  activeTab?: string;
  onTabChange?: (value: string) => void;
  additionalTab?: AdditionalQueryResultsTab;
  resultsDisabled?: boolean;
  showResultsTabWhenEmpty?: boolean;
  emptyResultsContent?: ReactNode;
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
  rowsLabel,
  showDuration = true,
  headerStructure,
  orderedColumnKeys,
  columnLabels,
  csvColumnKeys,
  csvColumnLabels,
  renderCell,
  paddingTop = 0,
  showNoRowsWarning = true,
  activeTab,
  onTabChange,
  additionalTab,
  resultsDisabled = false,
  showResultsTabWhenEmpty = false,
  emptyResultsContent,
}: Props) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [showQueryModal, setShowQueryModal] = useState(false);
  const cols = orderedColumnKeys ?? Object.keys(results?.[0] || {});
  const labels = columnLabels ?? cols;
  const useTwoRowHeader = headerStructure != null && orderedColumnKeys != null;
  const durationStatus = error ? "Query failed" : "Query succeeded";
  const showDurationStatus = showDuration && duration > 0;

  const forceShowSql = error || (!results.length && !showResultsTabWhenEmpty);
  const tabsProps =
    activeTab !== undefined
      ? {
          value: activeTab,
          onValueChange: onTabChange,
        }
      : {
          defaultValue: forceShowSql ? "sql" : "results",
        };

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
    <>
      {showQueryModal ? (
        <QueryModal
          close={() => setShowQueryModal(false)}
          language="sql"
          queries={[sql]}
        />
      ) : null}
      <Tabs
        key={forceShowSql ? "sql" : "results"}
        {...tabsProps}
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
              {(!forceShowSql || showResultsTabWhenEmpty) && (
                <TabsTrigger value="results" disabled={resultsDisabled}>
                  Results
                </TabsTrigger>
              )}
              {additionalTab ? (
                <TabsTrigger
                  value={additionalTab.value}
                  disabled={additionalTab.disabled}
                >
                  {additionalTab.label}
                </TabsTrigger>
              ) : null}
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
          {(!forceShowSql || showResultsTabWhenEmpty) && (
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
              {emptyResultsContent ? (
                emptyResultsContent
              ) : (
                <>
                  <div className="mt-2 rounded p-2 bg-light">
                    {downloadError ? (
                      <div className="mb-2">
                        <Callout status="error">{downloadError}</Callout>
                      </div>
                    ) : null}
                    <Flex align="center" gap="4">
                      <Flex align="center" flexGrow="1">
                        {totalPages > 1 ? (
                          <Flex align="center">
                            <div className="mr-1">
                              Showing {page * pageSize - pageSize + 1} -{" "}
                              {Math.min(page * pageSize, results.length)} of{" "}
                              <Tooltip
                                body={
                                  "GrowthBook limits the result to 1,000 rows max"
                                }
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
                          <strong className="pr-1">
                            {rowsLabel ??
                              `${showSampleHeader ? "Sample " : ""}${results?.length} Rows`}
                          </strong>
                        )}
                      </Flex>
                      {showDurationStatus ? (
                        <Tooltip body={durationStatus}>
                          <span
                            aria-label={`${durationStatus} in ${floatRound(duration, 2)} milliseconds`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              color: error
                                ? "var(--red-11)"
                                : "var(--green-11)",
                            }}
                          >
                            <PiTimer size={16} aria-hidden />
                            {floatRound(duration, 2)}ms
                          </span>
                        </Tooltip>
                      ) : null}
                      {sql || (allowDownload && results.length) ? (
                        <DropdownMenu
                          menuPlacement="end"
                          trigger={
                            <IconButton
                              variant="ghost"
                              color="gray"
                              radius="full"
                              size="1"
                              aria-label="Query result options"
                            >
                              <BsThreeDotsVertical size={16} />
                            </IconButton>
                          }
                        >
                          {sql ? (
                            <DropdownMenuItem
                              onClick={() => setShowQueryModal(true)}
                            >
                              View Rendered SQL
                            </DropdownMenuItem>
                          ) : null}
                          {allowDownload && results.length ? (
                            <DropdownMenuItem
                              onClick={() => {
                                setDownloadError(null);
                                try {
                                  handleDownload(results);
                                } catch (e) {
                                  setDownloadError(
                                    e instanceof Error
                                      ? e.message
                                      : "Error downloading results.",
                                  );
                                }
                              }}
                            >
                              Download CSV
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenu>
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
                </>
              )}
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
          {additionalTab ? (
            <TabsContent
              value={additionalTab.value}
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                minHeight: 0,
              }}
            >
              {additionalTab.content}
            </TabsContent>
          ) : null}
        </AreaWithHeader>
      </Tabs>
    </>
  );
}
