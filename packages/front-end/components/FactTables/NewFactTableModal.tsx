import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiArrowLeft, PiPlus, PiX } from "react-icons/pi";
import {
  CreateFactTableProps,
  DetectedFactTableColumn,
  FactFilterTestResults,
  FactTableInterface,
  FactTableType,
  RowFilter,
} from "shared/types/fact-table";
import { InformationSchemaTablesInterface } from "shared/types/integrations";
import { mapDatabaseTypeToEnum } from "shared/enterprise";
import { getDataSourceSqlDialect } from "shared/dialects";
import { buildRowFilterWhereClause } from "shared/experiments";
import { DocLink } from "@/components/DocLink";
import { getNewExperimentDatasourceDefaults } from "@/components/Experiment/NewExperimentForm";
import NewFactTableSqlStep, {
  FactTableSqlMode,
  SAMPLE_ROW_LIMIT,
} from "@/components/FactTables/NewFactTableSqlStep";
import {
  columnTypesToColumnSource,
  isRowFilterComplete,
} from "@/components/FactTables/rowFilterUtils";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getInitialFactTableQuery } from "@/services/datasources";
import {
  getColumnMappingError,
  getDefaultTimestampColumn,
  getNewFactTableProjects,
  getPartitionFilterColumn,
  getPickerColumns,
  getPickerTableError,
  getPickerTableName,
  getPickerTableSql,
  isIdentifierCandidate,
  isTimestampCandidate,
  PickerColumnSelection,
} from "@/services/factTables";
import { SchemaBrowserTable } from "@/services/schemaBrowserTables";
import track from "@/services/track";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import TextField from "@/ui/TextField";
import Callout from "@/ui/Callout";
import RadioGroup from "@/ui/RadioGroup";
import { Select, SelectItem } from "@/ui/Select";
import Table, { TableBody, TableCell, TableRow } from "@/ui/Table";
import Text from "@/ui/Text";
import Code from "@/components/SyntaxHighlighting/Code";
import Link from "@/ui/Link";

const normalizeIdentifier = (name: string) =>
  name.replace(/[^a-z]/gi, "").toLowerCase();

const INLINE_FILTER_CANDIDATES = [
  "event_name",
  "eventName",
  "event_type",
  "eventType",
  "event",
  "se_action",
];

const validColumn = (options: DetectedFactTableColumn[], column: string) =>
  options.some((c) => c.column === column) ? column : "";

function MappingRow({
  label,
  value,
  options,
  setValue,
  onRemove,
}: {
  label: string;
  value: string;
  options: DetectedFactTableColumn[];
  setValue: (column: string) => void;
  onRemove?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const selected = validColumn(options, value);

  return (
    <TableRow align="center">
      <TableCell style={{ width: "50%" }}>
        <Text size="sm" weight="medium">
          {label}
        </Text>
      </TableCell>
      {selected || adding || !onRemove ? (
        <>
          <TableCell>
            <Select
              size="sm"
              mb="0"
              autoFocus={adding}
              value={selected || undefined}
              setValue={setValue}
              placeholder="Select a column..."
            >
              {options.map((c) => (
                <SelectItem key={c.column} value={c.column}>
                  {c.column}
                </SelectItem>
              ))}
            </Select>
          </TableCell>
          <TableCell style={{ width: "40px" }}>
            {onRemove ? (
              <Flex align="center">
                <IconButton
                  type="button"
                  variant="ghost"
                  color="gray"
                  size="1"
                  onClick={() => {
                    setAdding(false);
                    onRemove();
                  }}
                  aria-label={`Remove ${label}`}
                >
                  <PiX />
                </IconButton>
              </Flex>
            ) : null}
          </TableCell>
        </>
      ) : (
        <TableCell colSpan={2}>
          <Button
            variant="ghost"
            size="sm"
            icon={<PiPlus />}
            onClick={() => setAdding(true)}
          >
            Add column
          </Button>
        </TableCell>
      )}
    </TableRow>
  );
}

const BODY_HEIGHT = "calc(93vh - 200px)";

const ALL_COLUMNS: PickerColumnSelection = { mode: "all", columns: [] };

export default function NewFactTableModal({ close }: { close: () => void }) {
  const router = useRouter();
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const { datasources, project, getDatasourceById, mutateDefinitions } =
    useDefinitions();

  const [step, setStep] = useState(0);
  const [datasourceId, setDatasourceId] = useState(
    () =>
      getNewExperimentDatasourceDefaults({ datasources, settings, project })
        .datasource,
  );
  const [sql, setSql] = useState("");
  const [mode, setMode] = useState<FactTableSqlMode>("table");
  const [selectedTable, setSelectedTable] = useState<SchemaBrowserTable | null>(
    null,
  );
  const [rowFilters, setRowFilters] = useState<RowFilter[]>([]);
  const [columnSelection, setColumnSelection] =
    useState<PickerColumnSelection>(ALL_COLUMNS);

  const [detected, setDetected] = useState<DetectedFactTableColumn[] | null>(
    null,
  );
  const [detectedSql, setDetectedSql] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [timestampColumn, setTimestampColumn] = useState("");
  const [userIdColumns, setUserIdColumns] = useState<Record<string, string>>(
    {},
  );
  const [inlineFilterColumn, setInlineFilterColumn] = useState("");
  const [tableType, setTableType] = useState<FactTableType>("event");

  const validateSql = useRef<(() => Promise<void>) | null>(null);
  // Last name filled in from a table, so a typed name is never replaced
  const autoName = useRef("");

  // Keyed off a ref so a background definitions refresh can't wipe user edits.
  const seededDatasource = useRef<string | null>(null);
  useEffect(() => {
    if (seededDatasource.current === datasourceId) return;
    const datasource = getDatasourceById(datasourceId);
    if (!datasource) return;
    seededDatasource.current = datasourceId;
    setSql(getInitialFactTableQuery(datasource).sql);
    setSelectedTable(null);
    setRowFilters([]);
    setColumnSelection(ALL_COLUMNS);
  }, [datasourceId, getDatasourceById]);

  const datasource = getDatasourceById(datasourceId);
  const canPickTable = !!datasource?.properties?.supportsInformationSchema;
  const sqlMode = canPickTable ? mode : "sql";

  const selectTable = (table: SchemaBrowserTable) => {
    if (table.id === selectedTable?.id) return;
    const tableName = getPickerTableName(table);
    setSelectedTable(table);
    setRowFilters([]);
    setColumnSelection(ALL_COLUMNS);
    // Otherwise handleColumnsDetected keeps the last table's mappings
    setDetected(null);
    setTimestampColumn("");
    setUserIdColumns({});
    setName((prev) => (!prev || prev === autoName.current ? tableName : prev));
    autoName.current = tableName;
  };
  const identifierTypes = (datasource?.settings?.userIdTypes || []).map(
    (t) => t.userIdType,
  );

  const timestampOptions = (detected || []).filter(isTimestampCandidate);
  const identifierOptions = (detected || []).filter(isIdentifierCandidate);
  // An event type is a low-cardinality string many rows share. A column named
  // like an id holds a value per row, so offering it would build a metric
  // filter whose dropdown lists every id in the table.
  const inlineFilterOptions = (detected || []).filter(
    (c) =>
      c.datatype === "string" &&
      !/id$/i.test(c.column) &&
      c.column !== timestampColumn &&
      !Object.values(userIdColumns).includes(c.column),
  );

  const removeIdentifier = (idType: string) =>
    setUserIdColumns((prev) => {
      const next = { ...prev };
      delete next[idType];
      return next;
    });

  const handleColumnsDetected = useCallback(
    (columns: DetectedFactTableColumn[], ranSql: string) => {
      setDetectedSql(ranSql);
      setDetected(columns);

      // Only re-detect when the SQL returns a different set of columns.
      // Better types for the same columns leave the configuration alone.
      if (
        detected &&
        detected.length === columns.length &&
        detected.every((c, i) => c.column === columns[i].column)
      ) {
        return;
      }

      const exists = (column: string) =>
        columns.some((c) => c.column === column);

      const idTypes = (datasource?.settings?.userIdTypes || []).map(
        (t) => t.userIdType,
      );

      // A mapping the user picked survives as long as its column does; only
      // the ones that no longer resolve are detected again.
      setTimestampColumn((prev) =>
        exists(prev) ? prev : getDefaultTimestampColumn(columns),
      );
      setUserIdColumns((prev) =>
        Object.fromEntries(
          idTypes.flatMap((idType) => {
            const current = prev[idType];
            if (current && exists(current)) return [[idType, current]];
            const match = columns.find(
              (c) =>
                normalizeIdentifier(c.column) === normalizeIdentifier(idType),
            );
            return match ? [[idType, match.column]] : [];
          }),
        ),
      );
      const eventTypeColumn =
        INLINE_FILTER_CANDIDATES.find((candidate) =>
          columns.some(
            (c) => c.column === candidate && c.datatype === "string",
          ),
        ) || "";
      setInlineFilterColumn(eventTypeColumn);
      setTableType(eventTypeColumn ? "event" : "model");
    },
    [detected, datasource],
  );

  const { data: tableData, error: tableDataError } = useApi<{
    table: InformationSchemaTablesInterface;
  }>(`/datasource/${datasourceId}/schema/table/${selectedTable?.id}`, {
    shouldRun: () => !!selectedTable,
  });
  const tableColumns = tableData?.table.columns ?? null;
  const tableColumnsLoading = !!selectedTable && !tableData && !tableDataError;

  const columnTypes = useMemo(
    () =>
      Object.fromEntries(
        (tableColumns ?? []).map((c) => [
          c.columnName,
          mapDatabaseTypeToEnum(c.dataType),
        ]),
      ),
    [tableColumns],
  );
  const columnSource = useMemo(
    () => (tableColumns ? columnTypesToColumnSource(columnTypes) : null),
    [tableColumns, columnTypes],
  );

  const dialect = datasource ? getDataSourceSqlDialect(datasource.type) : null;
  const compileRowFilters = (filters: RowFilter[]) => {
    if (!filters.length) return "";
    if (!dialect) {
      throw new Error("Row filters are not supported on this Data Source");
    }
    const now = new Date();
    return buildRowFilterWhereClause({
      rowFilters: filters,
      factTable: {
        columns: Object.entries(columnTypes).map(([column, datatype]) => ({
          column,
          datatype,
          name: column,
          description: "",
          numberFormat: "",
          deleted: false,
          dateCreated: now,
          dateUpdated: now,
        })),
        filters: [],
        userIdTypes: [],
      },
      dialect,
    });
  };

  // Null while the filters are incomplete or invalid
  let rowFilterWhere: string | null = null;
  let rowFilterError: string | null = null;
  if (rowFilters.every(isRowFilterComplete)) {
    try {
      rowFilterWhere = compileRowFilters(rowFilters);
    } catch (e) {
      rowFilterError = e.message;
    }
  }

  const pickerColumns = getPickerColumns(
    columnSelection,
    (tableColumns ?? []).map((c) => c.columnName),
  );
  const buildTableSql = (where: string) =>
    selectedTable
      ? getPickerTableSql(selectedTable, {
          partitionColumn: getPartitionFilterColumn(tableColumns ?? []),
          datasourceType: datasource?.type,
          identifierQuote: dialect?.identifierQuote,
          columns: pickerColumns,
          rowFilterWhere: where,
        })
      : "";
  const tableSql = buildTableSql(rowFilterWhere ?? "");

  const testRowFilters = async (filters: RowFilter[]) => {
    const where = compileRowFilters(filters);
    const res = await apiCall<FactFilterTestResults>("/query/test", {
      method: "POST",
      body: JSON.stringify({
        query: buildTableSql(where),
        datasourceId,
        limit: SAMPLE_ROW_LIMIT,
      }),
    });
    return { ...res, where };
  };
  const factTableSql = sqlMode === "table" ? tableSql : sql;

  const changeMode = (next: FactTableSqlMode) => {
    if (next === "sql" && selectedTable) setSql(tableSql);
    setMode(next);
  };

  const hasFreshResults = detectedSql === factTableSql && !!detected?.length;
  const columnError =
    hasFreshResults && detected
      ? getColumnMappingError(detected, sqlMode === "table")
      : sqlMode === "table" && selectedTable && tableColumns
        ? getPickerTableError(selectedTable, tableColumns, pickerColumns)
        : null;

  async function submit() {
    if (!detected) throw new Error("Test your SQL first");
    if (!datasource) throw new Error("Select a valid Data Source");
    if (!name) throw new Error("Enter a name for this Fact Table");

    const timestamp = validColumn(timestampOptions, timestampColumn);
    if (!timestamp) throw new Error("Select a timestamp column");

    const inlineFilter =
      tableType === "event"
        ? validColumn(inlineFilterOptions, inlineFilterColumn)
        : "";

    const userIdTypes = identifierTypes.filter((t) =>
      validColumn(identifierOptions, userIdColumns[t] || ""),
    );
    if (!userIdTypes.length) {
      throw new Error("Select at least one identifier column");
    }

    // Only remapped types need to be stored; an identifier whose column matches
    // its own name resolves without a mapping.
    const remapped = Object.fromEntries(
      userIdTypes
        .filter((t) => userIdColumns[t] !== t)
        .map((t) => [t, userIdColumns[t]]),
    );

    const body: CreateFactTableProps = {
      name,
      description: "",
      owner: "",
      tags: [],
      projects: getNewFactTableProjects({
        datasource,
        project,
        permissionsUtil,
      }),
      datasource: datasourceId,
      sql: factTableSql,
      eventName: name,
      tableType,
      userIdTypes,
      ...(Object.keys(remapped).length ? { userIdColumns: remapped } : {}),
      timestampColumn: timestamp,
      columns: detected.map((col) => ({
        column: col.column,
        datatype: col.datatype,
        ...(col.jsonFields ? { jsonFields: col.jsonFields } : {}),
        ...(col.column === inlineFilter ? { alwaysInlineFilter: true } : {}),
      })),
      // Types here come from a handful of sample rows. A background refresh
      // fills in anything we couldn't detect, plus the top values that power
      // inline filter dropdowns.
      columnRefreshPending: true,
    };

    const { factTable, error: apiError } = await apiCall<{
      factTable: FactTableInterface;
      error?: string;
    }>("/fact-tables", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (apiError) throw new Error(apiError);

    track("Create Fact Table");
    await mutateDefinitions();
    router.push(`/fact-tables/${factTable.id}`);
  }

  return (
    <PagedModal
      trackingEventModalType="new-fact-table"
      header="New Fact Table"
      step={step}
      setStep={setStep}
      submit={submit}
      close={close}
      cta="Create Fact Table"
      size={step === 0 && sqlMode === "sql" ? "max" : "md"}
      // Table mode waits for columns, since they can add the partition filter,
      // and for complete row filters and a non-empty column selection
      ctaEnabled={
        step > 0 ||
        (!columnError &&
          (sqlMode === "sql" ||
            (!!selectedTable &&
              !tableColumnsLoading &&
              rowFilterWhere !== null &&
              pickerColumns?.length !== 0)))
      }
      overflowAuto={false}
      autoFocusSelector=""
      hideNav
      bodyClassName="p-0"
      backButton
    >
      <Page
        display="Write SQL"
        validate={async () => {
          await validateSql.current?.();
        }}
      >
        <Box
          p="2"
          style={sqlMode === "sql" ? { height: BODY_HEIGHT } : undefined}
        >
          <NewFactTableSqlStep
            datasourceId={datasourceId}
            setDatasourceId={setDatasourceId}
            sql={factTableSql}
            setSql={setSql}
            detected={detected}
            hasFreshResults={hasFreshResults}
            onColumnsDetected={handleColumnsDetected}
            validateRef={validateSql}
            mode={sqlMode}
            setMode={changeMode}
            columnError={columnError}
            selectedTable={selectedTable}
            onSelectTable={selectTable}
            tableColumnsError={tableDataError?.message ?? null}
            rowFilters={rowFilters}
            setRowFilters={setRowFilters}
            columnSource={columnSource}
            testRowFilters={testRowFilters}
            rowFilterError={rowFilterError}
            columnSelection={columnSelection}
            setColumnSelection={setColumnSelection}
          />
        </Box>
      </Page>

      <Page display="Configure">
        <Box
          px="4"
          py="2"
          style={{ maxHeight: BODY_HEIGHT, overflowY: "auto" }}
        >
          <Flex direction="column" gap="2">
            {sqlMode === "table" && selectedTable ? (
              <Box pb="2">
                <TextField
                  label="Table"
                  value={`${selectedTable.schemaName}.${selectedTable.tableName}`}
                  readOnly
                  append={<Link onClick={() => setStep(0)}>Change</Link>}
                />
              </Box>
            ) : (
              <Code
                language="sql"
                code={factTableSql}
                expandable
                collapsedLines={3}
                filename={
                  <Link onClick={() => setStep(0)}>
                    <Flex align="center" gap="1">
                      <PiArrowLeft /> Edit SQL
                    </Flex>
                  </Link>
                }
              />
            )}
            <TextField
              label="Fact Table name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />

            <Box pt="2">
              <Text as="div" weight="semibold" mb="2">
                Table type
              </Text>
              <RadioGroup
                value={tableType}
                setValue={(v) => setTableType(v as FactTableType)}
                gap="1"
                mb="2"
                options={[
                  {
                    value: "model",
                    label: "Model",
                    description:
                      "Table for one specific object type: orders, signups, sessions, etc.",
                  },
                  {
                    value: "event",
                    label: "Event stream",
                    description: (
                      <>
                        Many event types differentiated by a column like{" "}
                        <strong>event_name</strong>
                      </>
                    ),
                  },
                  {
                    value: "rollup",
                    label: "Daily rollup",
                    description: "Pre-aggregated, one row per user per day",
                    renderOutsideItem: true,
                    renderOnSelect: (
                      <Box ml="5" mb="1">
                        <Callout status="warning" size="sm">
                          Pre-aggregated tables require some trade-offs.{" "}
                          <DocLink docSection="preAggregatedTables">
                            View docs
                          </DocLink>
                        </Callout>
                      </Box>
                    ),
                  },
                  {
                    value: "other",
                    label: "Other / unknown",
                  },
                ]}
              />
            </Box>

            <Box>
              <Text as="div" weight="semibold" mb="2">
                Column mapping
              </Text>
              <Table size="sm" variant="surface" layout="fixed" mb="2">
                <TableBody>
                  <MappingRow
                    label="timestamp"
                    value={timestampColumn}
                    options={timestampOptions}
                    setValue={setTimestampColumn}
                  />
                  {tableType === "event" ? (
                    <MappingRow
                      label="event_name"
                      value={inlineFilterColumn}
                      options={inlineFilterOptions}
                      setValue={setInlineFilterColumn}
                      onRemove={() => setInlineFilterColumn("")}
                    />
                  ) : null}
                  {identifierTypes.map((idType) => (
                    <MappingRow
                      key={idType}
                      label={idType}
                      value={userIdColumns[idType] || ""}
                      options={identifierOptions}
                      setValue={(v) => {
                        setUserIdColumns((prev) => ({
                          ...prev,
                          [idType]: v,
                        }));
                        if (v === inlineFilterColumn) setInlineFilterColumn("");
                      }}
                      onRemove={() => removeIdentifier(idType)}
                    />
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Flex>
        </Box>
      </Page>
    </PagedModal>
  );
}
