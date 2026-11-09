import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import {
  getFactTableIdColumn,
  getFactTableTimestampColumn,
} from "shared/experiments";
import { Fragment, ReactNode, useEffect, useMemo, useState } from "react";
import { PiArrowClockwise, PiCaretRightBold, PiPlusBold } from "react-icons/pi";
import { FaTriangleExclamation } from "react-icons/fa6";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import useColumnValueCounts from "@/hooks/useColumnValueCounts";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import ColumnModal from "./ColumnModal";
import VirtualColumnModal from "./VirtualColumnModal";
import ColumnValues, { ColumnValuesPanel } from "./ColumnValues";
import styles from "./FactTableDetailsPage.module.scss";
import eventsStyles from "./FactTableEventsTab.module.scss";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 60000;

type Row = ColumnInterface & { jsonFieldParent?: string };

export default function FactTableColumnsTab({
  factTable,
  canEdit,
  canLoadCounts,
  valueCounts,
}: {
  factTable: FactTableInterface;
  canEdit: boolean;
  canLoadCounts: boolean;
  valueCounts: ReturnType<typeof useColumnValueCounts>;
}) {
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const [editOpen, setEditOpen] = useState<ColumnInterface | null>(null);
  const [newVirtualOpen, setNewVirtualOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Virtual columns carry raw SQL, so they use the stricter gate
  const canManageVirtual =
    permissionsUtil.canManageFactTableVirtualColumn(factTable);

  // Silently poll for updates when columns are being refreshed in background
  useEffect(() => {
    if (!factTable.columnRefreshPending) return;
    const startTime = Date.now();
    const interval = setInterval(async () => {
      if (Date.now() - startTime > POLL_TIMEOUT_MS) {
        clearInterval(interval);
        return;
      }
      await mutateDefinitions();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [factTable.columnRefreshPending, mutateDefinitions]);

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

  const physical = factTable.columns.filter((c) => !c.deleted && !c.isVirtual);
  const virtual = factTable.columns.filter((c) => !c.deleted && c.isVirtual);

  return (
    <>
      {editOpen?.isVirtual ? (
        <VirtualColumnModal
          close={() => setEditOpen(null)}
          factTable={factTable}
          existing={editOpen}
          canDelete={canManageVirtual}
        />
      ) : editOpen ? (
        <ColumnModal
          close={() => setEditOpen(null)}
          factTable={factTable}
          existing={editOpen}
        />
      ) : null}
      {newVirtualOpen && (
        <VirtualColumnModal
          close={() => setNewVirtualOpen(false)}
          factTable={factTable}
        />
      )}

      {factTable.columnsError && (
        <Callout status="error">
          <span>
            <strong>
              Error {physical.length > 0 ? "Refreshing" : "Detecting"} Columns
            </strong>
            : {factTable.columnsError}
          </span>
        </Callout>
      )}
      {physical.length > 0 ? (
        <ColumnsTable
          factTable={factTable}
          columns={physical}
          toolbar={
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
          }
          renderDetail={(col) => (
            <>
              {col.name && col.name !== col.column ? (
                <Text as="div" size="sm" color="text-mid">
                  {col.name}
                </Text>
              ) : null}
              {col.description ? (
                <Text as="div" size="sm" color="text-mid">
                  {col.description}
                </Text>
              ) : null}
            </>
          )}
          renderExpanded={(col) => (
            <Flex justify="between" align="start" gap="3" py="2">
              <Box flexGrow="1">
                {/* Only string columns get top values */}
                {col.datatype === "string" ? (
                  <ColumnValuesPanel
                    column={col}
                    counts={valueCounts.counts[col.column]}
                    loading={!!valueCounts.loading[col.column]}
                    error={valueCounts.errors[col.column]}
                    onLoad={
                      canLoadCounts
                        ? () => valueCounts.load(col.column)
                        : undefined
                    }
                  />
                ) : (
                  <Text color="text-mid">
                    No value summary for {col.datatype || "unknown"} columns.
                  </Text>
                )}
              </Box>
              {canEdit ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditOpen(col)}
                >
                  Edit column
                </Button>
              ) : null}
            </Flex>
          )}
        />
      ) : (
        <Callout status="warning" mt="3">
          <span>
            <strong>Unable to Auto-Detect Columns</strong>. Double check your
            SQL above to make sure it&apos;s correct and returning rows.
          </span>
        </Callout>
      )}

      <Flex justify="between" align="center" mt="5" mb="2">
        <Heading as="h3" size="md" mb="0">
          Virtual Columns
        </Heading>
        {canManageVirtual ? (
          <Button
            size="sm"
            variant="outline"
            icon={<PiPlusBold />}
            onClick={() => setNewVirtualOpen(true)}
          >
            Add virtual column
          </Button>
        ) : null}
      </Flex>
      {virtual.length > 0 ? (
        <ColumnsTable
          factTable={factTable}
          columns={virtual}
          renderDetail={(col) => (
            <Text as="div" size="sm" color="text-mid">
              <span className={styles.mono}>{col.sql}</span>
            </Text>
          )}
          renderExpanded={(col) => (
            <Flex justify="between" align="start" gap="3" py="2">
              <Box flexGrow="1">
                <div className={eventsStyles.sectionLabel}>Expression</div>
                <div className={styles.expression}>{col.sql}</div>
              </Box>
              {canManageVirtual ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditOpen(col)}
                >
                  Edit column
                </Button>
              ) : null}
            </Flex>
          )}
        />
      ) : (
        <Text color="text-mid">No virtual columns yet.</Text>
      )}
    </>
  );
}

function ColumnsTable({
  factTable,
  columns,
  toolbar,
  renderDetail,
  renderExpanded,
}: {
  factTable: FactTableInterface;
  columns: ColumnInterface[];
  toolbar?: ReactNode;
  renderDetail: (column: ColumnInterface) => ReactNode;
  renderExpanded: (column: ColumnInterface) => ReactNode;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Each detected JSON sub-field gets its own read-only row
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const col of columns) {
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
  }, [columns]);

  const timestampColumn = getFactTableTimestampColumn(factTable);

  const computed = useAddComputedFields(rows, (column) => ({
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

  const { items, SortableTH, pagination } = useSearch({
    items: computed,
    defaultSortField: "dateCreated",
    localStorageKey: "factColumns",
    searchFields: ["name^3", "description", "column^2"],
    pageSize: 10,
  });

  return (
    <>
      {computed.some((col) => col.datatype === "") && (
        <Callout status="warning" mt="2">
          <span>
            Could not detect the data type for some columns. You can manually
            specify data types below. Only numeric columns can be used to create
            Metrics.
          </span>
        </Callout>
      )}
      <div className={styles.frame}>
        {toolbar}
        <table className={`table gbtable mb-0 ${styles.detailsTable}`}>
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <SortableTH field="column">Column</SortableTH>
              <SortableTH field="type">Type</SortableTH>
              <th>Roles</th>
              <th>Values</th>
            </tr>
          </thead>
          <tbody>
            {items.map((col) => {
              // JSON sub-fields are read-only, so they have no panel
              const expandable = !col.isJsonField;
              const isOpen = expandable && expanded === col.column;
              const toggle = () => setExpanded(isOpen ? null : col.column);
              return (
                <Fragment key={col.column}>
                  <tr
                    onClick={expandable ? toggle : undefined}
                    style={expandable ? { cursor: "pointer" } : undefined}
                  >
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
                              transform: isOpen ? "rotate(90deg)" : undefined,
                            }}
                          />
                        </IconButton>
                      ) : null}
                    </td>
                    <td>
                      {col.isJsonField ? (
                        <span
                          className={`text-muted ${styles.mono}`}
                          style={{ paddingLeft: 16 }}
                        >
                          {col.column}
                        </span>
                      ) : (
                        <>
                          <span className={`${styles.mono} ${styles.name}`}>
                            {col.column}
                          </span>
                          {renderDetail(col)}
                        </>
                      )}
                    </td>
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
                    <td>
                      <Flex gap="1" wrap="wrap">
                        {[
                          col.identifier && "Identifier",
                          col.column === timestampColumn && "Timestamp",
                          col.alwaysInlineFilter && "Filter",
                          col.isAutoSliceColumn && "Auto Slice",
                        ]
                          .filter((role): role is string => !!role)
                          .map((role) => (
                            <Badge
                              key={role}
                              label={role}
                              color="violet"
                              variant="soft"
                            />
                          ))}
                      </Flex>
                    </td>
                    <td>
                      {col.isJsonField ? null : <ColumnValues column={col} />}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td colSpan={5}>{renderExpanded(col)}</td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {pagination}
    </>
  );
}
