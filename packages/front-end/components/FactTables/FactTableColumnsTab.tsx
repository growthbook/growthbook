import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import { Fragment, ReactNode, useEffect, useMemo, useState } from "react";
import {
  PiArrowClockwise,
  PiCaretRightBold,
  PiPlusBold,
  PiWarningFill,
} from "react-icons/pi";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import useColumnValueCounts from "@/hooks/useColumnValueCounts";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/ui/Tooltip";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import { getColumnRole } from "@/services/columnEditModel";
import EditColumnModal from "./EditColumnModal";
import ColumnModal from "./ColumnModal";
import VirtualColumnModal from "./VirtualColumnModal";
import ColumnValues, { ColumnValuesPanel } from "./ColumnValues";
import styles from "./FactTableDetailsPage.module.scss";

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
  // Auto Slice levels, JSON fields and the like stay in the full editor
  // Stores the name, not the column, so a top values refresh in the editor
  // reads the latest values
  const [advancedOpen, setAdvancedOpen] = useState<string | null>(null);
  const advancedColumn = advancedOpen
    ? factTable.columns.find((c) => c.column === advancedOpen)
    : undefined;
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

  // Shown even with no columns, since a failed detection is when it's needed
  const refreshButton = canEdit ? (
    <Button
      size="sm"
      variant="ghost"
      icon={<PiArrowClockwise />}
      loading={refreshing || !!factTable.columnRefreshPending}
      onClick={refreshColumns}
    >
      Refresh
    </Button>
  ) : null;
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
        <EditColumnModal
          close={() => setEditOpen(null)}
          factTable={factTable}
          column={editOpen}
        />
      ) : null}
      {advancedColumn && (
        <ColumnModal
          close={() => setAdvancedOpen(null)}
          factTable={factTable}
          existing={advancedColumn}
        />
      )}
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
              Error {physical.length > 0 ? "refreshing" : "detecting"} columns
            </strong>
            : {factTable.columnsError}
          </span>
        </Callout>
      )}
      {physical.length > 0 ? (
        <ColumnsTable
          factTable={factTable}
          columns={physical}
          toolbar={refreshButton}
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
                {/* Only string columns get top values, and never identifiers,
                    which the server doesn't collect values for */}
                {getColumnRole(factTable, col.column) === "identifier" ? (
                  <Text color="text-mid">
                    No value summary for identifier columns.
                  </Text>
                ) : col.datatype === "string" ? (
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
                <Flex gap="2" flexShrink="0">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setAdvancedOpen(col.column)}
                  >
                    Advanced settings
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditOpen(col)}
                  >
                    Edit column
                  </Button>
                </Flex>
              ) : null}
            </Flex>
          )}
        />
      ) : (
        <Callout status="warning" mt="3" action={refreshButton}>
          <span>
            <strong>Unable to auto-detect columns</strong>. Double check your
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
          label="virtual columns"
          renderDetail={(col) => (
            <Text as="div" size="sm" color="text-mid">
              <span className={styles.mono}>{col.sql}</span>
            </Text>
          )}
          renderExpanded={(col) => (
            <Flex justify="between" align="start" gap="3" py="2">
              <Box flexGrow="1">
                <Text
                  as="div"
                  size="sm"
                  weight="semibold"
                  color="text-mid"
                  textTransform="uppercase"
                  mb="2"
                >
                  Expression
                </Text>
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
  label = "columns",
  renderDetail,
  renderExpanded,
}: {
  factTable: FactTableInterface;
  columns: ColumnInterface[];
  toolbar?: ReactNode;
  // What the rows are, for the search placeholder and empty state
  label?: string;
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

  const computed = useAddComputedFields(rows, (column) => ({
    ...column,
    name: column.name || column.column,
    id: column.name || column.column,
    role: getColumnRole(factTable, column.column),
    isJsonField: !!column.jsonFieldParent,
    type:
      column.datatype === "number"
        ? column.numberFormat || "number"
        : column.datatype,
  }));

  const { items, searchInputProps, SortableTableColumnHeader, pagination } =
    useSearch({
      items: computed,
      defaultSortField: "dateCreated",
      localStorageKey: "factColumns",
      searchFields: ["name^3", "description", "column^2"],
      pageSize: 10,
      // Several tables on this page search, so none of them owns ?q=
      disableUrlSearchTerm: true,
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
      <Flex direction="column" gap="3" mt="2">
        <Flex justify="between" align="center" gap="3">
          <TextField
            size="sm"
            type="search"
            placeholder={`Search ${columns.length} ${label}`}
            {...searchInputProps}
          />
          {toolbar}
        </Flex>
        <Table variant="list" roundedCorners>
          <TableHeader>
            <TableRow>
              <TableColumnHeader style={{ width: 32 }} />
              <SortableTableColumnHeader field="column">
                Column
              </SortableTableColumnHeader>
              <SortableTableColumnHeader field="type">
                Type
              </SortableTableColumnHeader>
              <TableColumnHeader>Roles</TableColumnHeader>
              <TableColumnHeader>Values</TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((col) => {
              // JSON sub-fields are read-only, so they have no panel
              const expandable = !col.isJsonField;
              const isOpen = expandable && expanded === col.column;
              const toggle = () => setExpanded(isOpen ? null : col.column);
              return (
                <Fragment key={col.column}>
                  <TableRow
                    align="center"
                    onClick={expandable ? toggle : undefined}
                    style={expandable ? { cursor: "pointer" } : undefined}
                  >
                    <TableCell className={styles.iconCell}>
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
                    </TableCell>
                    <TableCell>
                      {col.isJsonField ? (
                        <Text color="text-mid">
                          <span
                            className={styles.mono}
                            style={{ paddingLeft: 16 }}
                          >
                            {col.column}
                          </span>
                        </Text>
                      ) : (
                        <>
                          <span className={`${styles.mono} ${styles.name}`}>
                            {col.column}
                          </span>
                          {renderDetail(col)}
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      {col.datatype || "unknown"}{" "}
                      {col.datatype === "number" && col.numberFormat && (
                        <>({col.numberFormat})</>
                      )}
                      {col.datatype === "" && (
                        <Tooltip content="Unable to detect the data type. Edit this column to set one.">
                          <PiWarningFill color="var(--amber-11)" />
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell>
                      <Flex gap="1" wrap="wrap">
                        {[
                          col.role === "identifier" && "Identifier",
                          col.role === "timestamp" && "Timestamp",
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
                    </TableCell>
                    <TableCell>
                      {col.isJsonField ? null : <ColumnValues column={col} />}
                    </TableCell>
                  </TableRow>
                  {isOpen ? (
                    <TableRow>
                      <TableCell colSpan={5}>{renderExpanded(col)}</TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
            {!items.length ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Text color="text-mid">No {label} match your search.</Text>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Flex>
      {pagination}
    </>
  );
}
