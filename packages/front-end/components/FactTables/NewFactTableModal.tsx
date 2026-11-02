import { ReactNode, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiArrowLeft,
  PiCaretDown,
  PiCaretUp,
  PiMagnifyingGlass,
  PiPlus,
  PiX,
} from "react-icons/pi";
import {
  CreateFactTableProps,
  DetectedColumn,
  FactTableInterface,
  FactTableType,
} from "shared/types/fact-table";
import { isProjectListValidForProject } from "shared/util";
import { DocLink } from "@/components/DocLink";
import {
  getNewExperimentDatasourceDefaults,
  getInitialFactTableQuery,
} from "@/services/datasources";
import SourceStep from "@/components/SchemaBrowser/SourceStep";
import { useSourceTable } from "@/components/SchemaBrowser/useSourceTable";
import ColumnMappingRow, {
  ColumnKindIcon,
  validColumn,
} from "@/components/SchemaBrowser/ColumnMappingRow";
import SelectField from "@/components/Forms/SelectField";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  GA4_EVENTS_TEMPLATE,
  getColumnMappingError,
  getDefaultTimestampColumn,
  getNewFactTableProjects,
  findEventTypeColumn,
  getRemappedUserIdColumns,
  rematchColumn,
  rematchUserIdColumns,
  isIdentifierCandidate,
  isTimestampCandidate,
} from "@/services/factTables";
import track from "@/services/track";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import TextField from "@/ui/TextField";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import { Popover } from "@/ui/Popover";
import RadioGroup from "@/ui/RadioGroup";
import { Select, SelectItem } from "@/ui/Select";
import Table, { TableBody, TableCell, TableRow } from "@/ui/Table";
import Text from "@/ui/Text";
import Code from "@/components/SyntaxHighlighting/Code";
import Link from "@/ui/Link";

const TABLE_TYPES: {
  value: FactTableType;
  label: string;
  description?: string;
}[] = [
  {
    value: "model",
    label: "Model",
    description:
      "Table for one specific object type: orders, signups, sessions, etc.",
  },
  {
    value: "event",
    label: "Event stream",
    description: "Many event types differentiated by a column like event_name",
  },
  {
    value: "rollup",
    label: "Daily rollup",
    description: "Pre-aggregated, one row per user per day",
  },
  { value: "other", label: "Other / unknown" },
];

const MANY_COLUMNS = 50;

function AdditionalColumnsRow({
  value,
  setValue,
  options,
  columnTypes,
}: {
  value: string[];
  setValue: (value: string[]) => void;
  options: string[];
  columnTypes: Record<string, string>;
}) {
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const removed = options.filter((c) => !value.includes(c));
  const query = search.trim().toLowerCase();
  const shown = removed.filter((c) => c.toLowerCase().includes(query));
  const open = adding && removed.length > 0;
  const count = removed.length
    ? `${value.length} of ${options.length} columns`
    : `${options.length} columns`;
  const add = (columns: string[]) => {
    setValue(options.filter((c) => value.includes(c) || columns.includes(c)));
    setSearch("");
    if (columns.length === removed.length) setAdding(false);
  };

  return (
    <TableRow align="start">
      <TableCell>
        <Flex align="center" gap="2" height="24px">
          <ColumnKindIcon kind="columns" />
          <Text size="sm" weight="medium">
            Additional columns
          </Text>
        </Flex>
      </TableCell>
      <TableCell>
        <Flex direction="column" gap="2">
          <Flex
            wrap="wrap"
            gap="1"
            p="1"
            style={{
              maxHeight: 168,
              overflowY: "auto",
              border: "1px solid var(--gray-a7)",
              borderRadius: "var(--radius-2)",
            }}
          >
            {value.length ? (
              value.map((c) => (
                <Badge
                  key={c}
                  size="xs"
                  variant="soft"
                  label={
                    <Flex align="center" gap="1">
                      {c}
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="1"
                        aria-label={`Remove ${c}`}
                        onClick={() => setValue(value.filter((v) => v !== c))}
                        style={{
                          margin: 0,
                          width: 12,
                          height: 12,
                          padding: "2px 0",
                        }}
                      >
                        <PiX size={10} />
                      </IconButton>
                    </Flex>
                  }
                />
              ))
            ) : (
              <Text size="sm" color="text-low" fontStyle="italic">
                none
              </Text>
            )}
          </Flex>
          <Flex align="center" justify="between" gap="2">
            {removed.length ? (
              <Popover
                open={open}
                onOpenChange={(next) => {
                  setAdding(next);
                  setSearch("");
                }}
                side="bottom"
                align="start"
                showArrow={false}
                contentStyle={{ padding: 0, width: 320 }}
                trigger={
                  <Link size="sm">
                    <Flex align="center" gap="1">
                      {count}
                      {open ? <PiCaretUp /> : <PiCaretDown />}
                    </Flex>
                  </Link>
                }
                content={
                  <>
                    <Box
                      p="2"
                      style={{ borderBottom: "1px solid var(--gray-a4)" }}
                    >
                      <TextField
                        size="sm"
                        type="search"
                        aria-label="Filter removed columns"
                        placeholder={
                          value.length
                            ? "Filter removed columns"
                            : `Filter ${options.length} columns`
                        }
                        prepend={<PiMagnifyingGlass />}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        autoFocus
                      />
                    </Box>
                    <Flex
                      direction="column"
                      p="1"
                      style={{ maxHeight: 216, overflowY: "auto" }}
                    >
                      {shown.length ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<PiPlus />}
                            m="0"
                            style={{ justifyContent: "flex-start" }}
                            onClick={() => add(shown)}
                          >
                            {query
                              ? `Add all ${shown.length} matching "${search.trim()}"`
                              : `Add all ${shown.length}${value.length ? " back" : ""}`}
                          </Button>
                          {shown.map((c) => (
                            <Button
                              key={c}
                              variant="ghost"
                              color="gray"
                              size="sm"
                              m="0"
                              style={{ justifyContent: "space-between" }}
                              icon={
                                <Text size="sm" color="text-low">
                                  {columnTypes[c]}
                                </Text>
                              }
                              iconPosition="right"
                              onClick={() => add([c])}
                            >
                              {c}
                            </Button>
                          ))}
                        </>
                      ) : (
                        <Text size="sm" color="text-low" align="center" my="2">
                          No columns match &quot;{search.trim()}&quot;
                        </Text>
                      )}
                    </Flex>
                  </>
                }
              />
            ) : (
              <Text size="sm" color="text-low">
                {count}
              </Text>
            )}
            {value.length ? (
              <Link
                size="sm"
                onClick={() => {
                  setValue([]);
                  setAdding(false);
                }}
              >
                Remove all
              </Link>
            ) : null}
          </Flex>
        </Flex>
      </TableCell>
      <TableCell style={{ width: "40px" }} />
    </TableRow>
  );
}

const BODY_HEIGHT = "calc(93vh - 200px)";

export default function NewFactTableModal({
  close,
  datasourceId: initialDatasourceId,
  lockDatasource = false,
}: {
  close: () => void;
  datasourceId?: string;
  lockDatasource?: boolean;
}) {
  const router = useRouter();
  const growthbook = useGrowthBook();
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const { datasources, project, getDatasourceById, mutateDefinitions } =
    useDefinitions();

  const [step, setStep] = useState(0);
  const [datasourceId, setDatasourceId] = useState(
    () =>
      initialDatasourceId ||
      getNewExperimentDatasourceDefaults({ datasources, settings, project })
        .datasource,
  );
  const [sql, setSql] = useState("");
  const [removedColumns, setRemovedColumns] = useState<string[]>([]);

  const [name, setName] = useState("");
  const [timestampColumn, setTimestampColumn] = useState("");
  const [userIdColumns, setUserIdColumns] = useState<Record<string, string>>(
    {},
  );
  const [inlineFilterColumn, setInlineFilterColumn] = useState("");
  const [tableType, setTableType] = useState<FactTableType>("event");

  const validateSql = useRef<(() => Promise<void>) | null>(null);

  // Keyed off a ref so a background definitions refresh can't wipe user edits.
  const seededDatasource = useRef<string | null>(null);
  useEffect(() => {
    if (seededDatasource.current === datasourceId) return;
    const datasource = getDatasourceById(datasourceId);
    if (!datasource) return;
    seededDatasource.current = datasourceId;
    setSql(getInitialFactTableQuery(datasource).sql);
    setRemovedColumns([]);
  }, [datasourceId, getDatasourceById]);

  const datasource = getDatasourceById(datasourceId);
  const validDatasources = datasources
    .filter((d) => isProjectListValidForProject(d.projects, project))
    .filter((d) => d.properties?.queryLanguage === "sql");
  const identifierTypes = (datasource?.settings?.userIdTypes || []).map(
    (t) => t.userIdType,
  );

  const removeIdentifier = (idType: string) =>
    setUserIdColumns((prev) => {
      const next = { ...prev };
      delete next[idType];
      return next;
    });

  // Better types for the same columns leave the configuration alone, so this
  // only runs when the columns themselves change
  const remapColumns = (columns: DetectedColumn[]) => {
    setTimestampColumn((prev) =>
      rematchColumn(prev, columns, () => getDefaultTimestampColumn(columns)),
    );
    setUserIdColumns((prev) =>
      rematchUserIdColumns(prev, identifierTypes, columns),
    );
    if (columns.some((c) => c.column === inlineFilterColumn)) return;
    const eventTypeColumn = findEventTypeColumn(columns);
    setInlineFilterColumn(eventTypeColumn);
    setTableType(eventTypeColumn ? "event" : "model");
  };

  const source = useSourceTable({
    datasource,
    tableModeAvailable: growthbook.isOn("fact-table-table-mode"),
    templates: [GA4_EVENTS_TEMPLATE],
    queryType: "factTableTest",
    sql,
    setSql,
    getColumnMappingError,
    columnSelection: {
      mapped: [
        timestampColumn,
        tableType === "event" ? inlineFilterColumn : "",
        ...Object.values(userIdColumns),
      ].filter(Boolean),
      removed: removedColumns,
    },
    onSelectTable: (tableName) => {
      if (!name || name === source.tableName) setName(tableName);
      setRemovedColumns([]);
      // Otherwise the previous table's mappings carry over
      setTimestampColumn("");
      setUserIdColumns({});
      setInlineFilterColumn("");
    },
    onColumnsChanged: remapColumns,
  });
  const {
    mode,
    selectedTable,
    detected,
    sqlColumns,
    otherColumns,
    additionalColumns,
    partition,
  } = source;
  const factTableSql = source.querySql;

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

  const missingMapping = !validColumn(timestampOptions, timestampColumn)
    ? "Select a timestamp column"
    : !identifierTypes.some((t) =>
          validColumn(identifierOptions, userIdColumns[t] || ""),
        )
      ? "Select at least one identifier column"
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

    const remapped = getRemappedUserIdColumns(userIdTypes, userIdColumns);

    const columns =
      mode === "table" && sqlColumns.length
        ? detected.filter((c) => sqlColumns.includes(c.column))
        : detected;

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
      columns: columns.map((col) => ({
        column: col.column,
        datatype: col.datatype,
        ...(col.jsonFields ? { jsonFields: col.jsonFields } : {}),
        ...(col.column === inlineFilter ? { alwaysInlineFilter: true } : {}),
      })),
      // A background refresh re-detects types and loads inline filter values
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

  const nameField = (
    <TextField
      label="Fact Table name"
      value={name}
      onChange={(e) => setName(e.target.value)}
      required
      autoFocus
    />
  );

  const rollupWarning = (
    <Callout status="warning" size="sm">
      Pre-aggregated tables require some trade-offs.{" "}
      <DocLink docSection="preAggregatedTables">View docs</DocLink>
    </Callout>
  );

  const mappingTable = (additionalRow?: ReactNode) => (
    <Table size="sm" variant="surface" layout="fixed" mb="2">
      <TableBody>
        <ColumnMappingRow
          kind="timestamp"
          label="Timestamp"
          value={timestampColumn}
          options={timestampOptions}
          setValue={setTimestampColumn}
        />
        {tableType === "event" ? (
          <ColumnMappingRow
            kind="event"
            label="Event name"
            value={inlineFilterColumn}
            options={inlineFilterOptions}
            setValue={setInlineFilterColumn}
            onRemove={() => setInlineFilterColumn("")}
          />
        ) : null}
        {identifierTypes.map((idType) => (
          <ColumnMappingRow
            key={idType}
            kind="identifier"
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
        {additionalRow}
      </TableBody>
    </Table>
  );

  const isGA4 = source.template === GA4_EVENTS_TEMPLATE;

  return (
    <PagedModal
      trackingEventModalType="new-fact-table"
      header="New Fact Table"
      step={step}
      setStep={setStep}
      submit={submit}
      close={close}
      cta="Create Fact Table"
      size={step === 0 && mode === "sql" ? "max" : "md"}
      disabledMessage={
        (step > 0
          ? missingMapping
          : source.loadingColumns
            ? "Loading columns..."
            : null) ?? undefined
      }
      ctaEnabled={step > 0 ? !missingMapping : source.canContinue}
      overflowAuto={false}
      autoFocusSelector=""
      hideNav
      bodyClassName="p-0"
      backButton
      onBackFirstStep={source.backToTableMode}
    >
      <Page
        display="Write SQL"
        validate={async () => {
          await validateSql.current?.();
        }}
      >
        <Box
          p="2"
          style={
            mode === "sql"
              ? { height: BODY_HEIGHT }
              : { maxHeight: BODY_HEIGHT, overflowY: "auto" }
          }
        >
          <SourceStep
            key={mode}
            source={source}
            validateRef={validateSql}
            placeholder={"SELECT\n  user_id,\n  timestamp\nFROM\n  events"}
            datasourceHeader={
              <Select
                aria-label="Data Source"
                value={datasourceId}
                setValue={setDatasourceId}
                disabled={lockDatasource}
                placeholder="Select..."
                mb="0"
              >
                {validDatasources.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </Select>
            }
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
            {mode === "table" && selectedTable ? (
              <>
                <Box pb="2">
                  <TextField
                    label="Source table"
                    value={selectedTable.path.replace(/`/g, "")}
                    readOnly
                    append={<Link onClick={() => setStep(0)}>Change</Link>}
                  />
                </Box>
                {nameField}

                <Box pt="2">
                  <SelectField
                    label="Type"
                    legacyLabelFormatting={false}
                    value={tableType}
                    onChange={(v) => setTableType(v as FactTableType)}
                    options={TABLE_TYPES}
                    formatOptionLabel={({ value, label }, { context }) => {
                      const description = TABLE_TYPES.find(
                        (t) => t.value === value,
                      )?.description;
                      return (
                        <Box py={context === "value" ? "1" : undefined}>
                          <Text as="div">{label}</Text>
                          {description ? (
                            <Text as="div" size="sm" color="text-low">
                              {description}
                            </Text>
                          ) : null}
                        </Box>
                      );
                    }}
                    size="md"
                    sort={false}
                    isSearchable={false}
                  />
                </Box>
                {tableType === "rollup" ? rollupWarning : null}

                <Box pt="2">
                  <Text as="div" weight="semibold" mb="2">
                    Column mapping
                  </Text>
                  {mappingTable(
                    isGA4 ? null : (
                      <>
                        {partition.available ? (
                          <ColumnMappingRow
                            kind="partition"
                            label="Date partition"
                            tooltip="Only reads partitions from each query's start date on, to limit data scanned"
                            value={partition.column}
                            options={partition.options}
                            setValue={partition.setColumn}
                            onRemove={() => partition.setColumn("")}
                            append={
                              partition.formats.length ? (
                                <Select
                                  size="sm"
                                  mb="0"
                                  aria-label="Partition format"
                                  value={partition.format}
                                  setValue={partition.setFormat}
                                >
                                  {partition.formats.map((f) => (
                                    <SelectItem key={f} value={f}>
                                      {f.toUpperCase()}
                                    </SelectItem>
                                  ))}
                                </Select>
                              ) : null
                            }
                          />
                        ) : null}
                        <AdditionalColumnsRow
                          value={additionalColumns}
                          setValue={(kept) =>
                            setRemovedColumns(
                              otherColumns.filter((c) => !kept.includes(c)),
                            )
                          }
                          options={otherColumns}
                          columnTypes={source.columnTypes}
                        />
                      </>
                    ),
                  )}
                  {isGA4 ? (
                    <Callout status="info" size="sm">
                      GA4 events table detected. Common columns were selected
                      automatically.
                    </Callout>
                  ) : !sqlColumns.length &&
                    otherColumns.length > MANY_COLUMNS ? (
                    <Callout status="info" size="sm">
                      For the best experience, only select the specific columns
                      that you need.
                    </Callout>
                  ) : null}
                </Box>
              </>
            ) : (
              <>
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
                {nameField}

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
                            {rollupWarning}
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
                  {mappingTable()}
                </Box>
              </>
            )}
          </Flex>
        </Box>
      </Page>
    </PagedModal>
  );
}
