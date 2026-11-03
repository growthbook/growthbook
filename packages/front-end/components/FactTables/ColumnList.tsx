import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import {
  getFactTableIdColumn,
  getFactTableTimestampColumn,
} from "shared/experiments";
import { Fragment, ReactNode, useEffect, useMemo, useState } from "react";
import {
  PiUserBold,
  PiClockBold,
  PiStackBold,
  PiFunnelBold,
  PiCaretRightBold,
  PiArrowClockwise,
  PiPencilSimpleFill,
} from "react-icons/pi";
import { FaTriangleExclamation } from "react-icons/fa6";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Avatar from "@/ui/Avatar";
import Text from "@/ui/Text";
import ColumnModal from "./ColumnModal";
import styles from "./ColumnList.module.scss";

export interface Props {
  factTable: FactTableInterface;
  canEdit?: boolean;
  // Adds a Values column, rendered per non-JSON-field column
  renderValues?: (column: ColumnInterface) => ReactNode;
  // Makes columns with stored top values expandable, rendering this plus the
  // edit button below the row (replaces the pencil)
  renderExpanded?: (column: ColumnInterface) => ReactNode;
  hideSearch?: boolean;
  // Redesigned details page: no icon, display name, or edit columns, and
  // roomier rows
  detailsLayout?: boolean;
}

const POLL_INTERVAL_MS = 3000; // Poll every 3 seconds
const POLL_TIMEOUT_MS = 60000; // Give up after 1 minute

export default function ColumnList({
  factTable,
  canEdit = false,
  renderValues,
  renderExpanded,
  hideSearch = false,
  detailsLayout = false,
}: Props) {
  const [editOpen, setEditOpen] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { mutateDefinitions } = useDefinitions();
  const { apiCall } = useAuth();

  // Silently poll for updates when columns are being refreshed in background
  useEffect(() => {
    if (!factTable.columnRefreshPending) return;

    const startTime = Date.now();

    const interval = setInterval(async () => {
      // Give up after timeout
      if (Date.now() - startTime > POLL_TIMEOUT_MS) {
        clearInterval(interval);
        return;
      }
      await mutateDefinitions();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [factTable.columnRefreshPending, mutateDefinitions]);

  // Expand JSON columns so each detected sub-field (e.g. `attributes.plan`)
  // shows as its own read-only pseudo-column row, rather than being hidden
  // inside a single `attributes` row.
  const availableColumns = useMemo(() => {
    const out: (ColumnInterface & { jsonFieldParent?: string })[] = [];
    for (const col of factTable.columns || []) {
      if (col.deleted) continue;
      // Virtual columns are managed in their own tab, not the Columns list.
      if (col.isVirtual) continue;
      out.push(col);
      if (col.datatype === "json" && col.jsonFields) {
        for (const [field, data] of Object.entries(col.jsonFields)) {
          out.push({
            ...col,
            column: `${col.column}.${field}`,
            name: `${col.column}.${field}`,
            datatype: data.datatype,
            jsonFields: undefined,
            isAutoSliceColumn: false,
            alwaysInlineFilter: false,
            autoSlices: undefined,
            jsonFieldParent: col.column,
          });
        }
      }
    }
    return out;
  }, [factTable]);

  const timestampColumn = getFactTableTimestampColumn(factTable);

  const columns = useAddComputedFields(availableColumns, (column) => ({
    ...column,
    name: column.name || column.column,
    id: column.name || column.column,
    identifier: factTable.userIdTypes.some(
      (idType) => getFactTableIdColumn(factTable, idType) === column.column,
    ),
    isJsonField: !!column.jsonFieldParent,
    type:
      column.datatype === "number"
        ? column.numberFormat || "number"
        : column.datatype,
  }));

  const { items, searchInputProps, isFiltered, SortableTH, clear, pagination } =
    useSearch({
      items: columns,
      defaultSortField: "dateCreated",
      localStorageKey: "factColumns",
      searchFields: ["name^3", "description", "column^2"],
      pageSize: 10,
    });

  async function refreshColumns() {
    setRefreshing(true);
    try {
      await apiCall(`/fact-tables/${factTable.id}?forceColumnRefresh=1`, {
        method: "PUT",
        body: JSON.stringify({}),
      });
      await mutateDefinitions();
    } finally {
      setRefreshing(false);
    }
  }

  const numCols =
    (detailsLayout ? 2 : 5) + (renderValues ? 1 : 0) + (renderExpanded ? 1 : 0);

  const existing = editOpen
    ? factTable.columns.find((c) => c.column === editOpen)
    : null;

  // The details layout puts the table in a frame with a refresh strip on top
  const refreshStrip = detailsLayout ? (
    <Flex justify="end" align="center" gap="3" px="4" py="3">
      {canEdit ? (
        <Button
          size="sm"
          variant="ghost"
          icon={<PiArrowClockwise />}
          loading={refreshing || !!factTable.columnRefreshPending}
          onClick={refreshColumns}
        >
          Refresh
        </Button>
      ) : null}
    </Flex>
  ) : null;

  return (
    <>
      {existing ? (
        <ColumnModal
          close={() => setEditOpen("")}
          factTable={factTable}
          existing={existing}
        />
      ) : null}

      {factTable.columnsError && (
        <Callout status="error">
          <span>
            <strong>
              Error {columns.length > 0 ? "Refreshing" : "Detecting"} Columns
            </strong>
            : {factTable.columnsError}
          </span>
        </Callout>
      )}

      {!detailsLayout ? (
        <Flex align="center" gap="4">
          {columns.length > 0 && !hideSearch && (
            <Box mr="auto">
              <Field
                size="legacy"
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </Box>
          )}
          {canEdit && (
            <Box>
              <Button
                size="sm"
                variant="outline"
                loading={refreshing || !!factTable.columnRefreshPending}
                onClick={refreshColumns}
              >
                Refresh
              </Button>
            </Box>
          )}
        </Flex>
      ) : null}
      {columns.some((col) => !col.deleted && col.datatype === "") && (
        <Callout status="warning" mt="2">
          <span>
            Could not detect the data type for some columns. You can manually
            specify data types below. Only numeric columns can be used to create
            Metrics.
          </span>
        </Callout>
      )}
      {columns.length > 0 ? (
        <>
          <div className={detailsLayout ? styles.frame : undefined}>
            {refreshStrip}
            <table
              className={
                detailsLayout
                  ? `table gbtable mb-0 ${styles.detailsTable}`
                  : "table table-tiny appbox gbtable mt-2 mb-0"
              }
            >
              <thead>
                <tr>
                  {renderExpanded ? <th style={{ width: 30 }}></th> : null}
                  {!detailsLayout ? <th style={{ width: 30 }}></th> : null}
                  <SortableTH field="column">Column</SortableTH>
                  {!detailsLayout ? <th></th> : null}
                  <SortableTH field="type">Type</SortableTH>
                  {renderValues ? <th>Values</th> : null}
                  {!detailsLayout ? <th style={{ width: 30 }}></th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((col) => {
                  const expandable =
                    !!renderExpanded &&
                    !col.isJsonField &&
                    !!col.topValues?.length;
                  const isOpen = expandable && expanded === col.column;
                  const toggle = () => setExpanded(isOpen ? null : col.column);
                  return (
                    <Fragment key={col.column}>
                      <tr
                        onClick={expandable ? toggle : undefined}
                        style={expandable ? { cursor: "pointer" } : undefined}
                      >
                        {renderExpanded ? (
                          <td className={styles.iconCell}>
                            {expandable ? (
                              <IconButton
                                variant="ghost"
                                size="1"
                                aria-expanded={isOpen}
                                aria-label={`${isOpen ? "Collapse" : "Expand"} ${col.column}`}
                              >
                                <PiCaretRightBold
                                  style={{
                                    transform: isOpen
                                      ? "rotate(90deg)"
                                      : undefined,
                                  }}
                                />
                              </IconButton>
                            ) : canEdit && !col.isJsonField ? (
                              // No panel to hold the Edit button
                              <IconButton
                                variant="ghost"
                                size="1"
                                aria-label={`Edit ${col.column}`}
                                onClick={() => setEditOpen(col.column)}
                              >
                                <PiPencilSimpleFill />
                              </IconButton>
                            ) : null}
                          </td>
                        ) : null}
                        {!detailsLayout ? (
                          <td>
                            <div
                              className="d-flex align-items-center"
                              style={{ minHeight: 32 }}
                            >
                              {col.identifier && (
                                <Tooltip
                                  body="User Identifier Type"
                                  tipPosition="left"
                                >
                                  <Avatar
                                    size="sm"
                                    color="violet"
                                    variant="soft"
                                    radius="small"
                                  >
                                    <PiUserBold size={14} />
                                  </Avatar>
                                </Tooltip>
                              )}
                              {col.column === timestampColumn && (
                                <Tooltip
                                  body="Main date field used for sorting and filtering"
                                  tipPosition="left"
                                >
                                  <Avatar
                                    size="sm"
                                    color="violet"
                                    variant="soft"
                                    radius="small"
                                  >
                                    <PiClockBold size={14} />
                                  </Avatar>
                                </Tooltip>
                              )}
                              {col.isAutoSliceColumn && (
                                <div style={{ position: "relative" }}>
                                  <Tooltip
                                    body={
                                      (!col.autoSlices ||
                                        col.autoSlices.length === 0) &&
                                      col.datatype !== "boolean"
                                        ? "Auto slices enabled, no slice levels configured"
                                        : "Auto slices enabled"
                                    }
                                    tipPosition="left"
                                  >
                                    <Avatar
                                      size="sm"
                                      color="violet"
                                      variant="soft"
                                      radius="small"
                                    >
                                      <PiStackBold size={14} />
                                    </Avatar>
                                  </Tooltip>
                                  {(!col.autoSlices ||
                                    (col.autoSlices.length === 0 &&
                                      col.datatype !== "boolean")) && (
                                    <div
                                      style={{
                                        position: "absolute",
                                        top: -2,
                                        right: -2,
                                        width: 8,
                                        height: 8,
                                        backgroundColor: "var(--red-10)",
                                        borderRadius: "50%",
                                        border: "1px solid white",
                                      }}
                                    />
                                  )}
                                </div>
                              )}
                              {col.alwaysInlineFilter && (
                                <Tooltip
                                  body="Prompt all metrics to filter on this column"
                                  tipPosition="left"
                                >
                                  <Avatar
                                    size="sm"
                                    color="violet"
                                    variant="soft"
                                    radius="small"
                                  >
                                    <PiFunnelBold size={14} />
                                  </Avatar>
                                </Tooltip>
                              )}
                            </div>
                          </td>
                        ) : null}
                        <td>
                          {col.isJsonField ? (
                            <span
                              className="text-muted"
                              style={{ paddingLeft: 16 }}
                            >
                              {col.column}
                            </span>
                          ) : (
                            col.column
                          )}
                          {detailsLayout && col.name !== col.column ? (
                            <Text as="div" size="sm" color="text-mid">
                              {col.name}
                            </Text>
                          ) : null}
                        </td>
                        {!detailsLayout ? (
                          <td>
                            {col.name !== col.column ? `"${col.name}"` : ""}
                          </td>
                        ) : null}
                        <td>
                          {col.datatype || "unknown"}{" "}
                          {col.datatype === "number" && col.numberFormat && (
                            <>({col.numberFormat})</>
                          )}
                          {col.datatype === "" && (
                            <Tooltip body="Unable to detect the data type. Edit this column to set one.">
                              <FaTriangleExclamation className="text-danger" />
                            </Tooltip>
                          )}
                        </td>
                        {renderValues ? (
                          <td>{col.isJsonField ? null : renderValues(col)}</td>
                        ) : null}
                        {!detailsLayout ? (
                          <td>
                            <div className="d-flex align-items-center px-1">
                              {canEdit &&
                                !col.isJsonField &&
                                !renderExpanded && (
                                  <IconButton
                                    size="2"
                                    variant="ghost"
                                    onClick={() => setEditOpen(col.column)}
                                  >
                                    <PiPencilSimpleFill size={14} />
                                  </IconButton>
                                )}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                      {isOpen && renderExpanded ? (
                        <tr>
                          <td colSpan={numCols}>
                            <Flex
                              justify="between"
                              align="start"
                              gap="3"
                              py="2"
                            >
                              <Box flexGrow="1">{renderExpanded(col)}</Box>
                              {canEdit ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setEditOpen(col.column)}
                                >
                                  Edit column
                                </Button>
                              ) : null}
                            </Flex>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {!items.length && isFiltered && (
                  <tr>
                    <td colSpan={numCols} align={"center"}>
                      No matching columns.{" "}
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          clear();
                        }}
                      >
                        Clear search field
                      </a>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {pagination}
        </>
      ) : (
        <Callout status="warning" mt="3">
          <span>
            <strong>Unable to Auto-Detect Columns</strong>. Double check your
            SQL above to make sure it&apos;s correct and returning rows.
          </span>
        </Callout>
      )}
    </>
  );
}
