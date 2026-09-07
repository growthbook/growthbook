import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { PiArrowLeft, PiPlus, PiX } from "react-icons/pi";
import {
  CreateFactTableProps,
  DetectedFactTableColumn,
  FactTableColumnType,
  FactTableInterface,
  FactTableType,
  NumberFormat,
} from "shared/types/fact-table";
import { DocLink } from "@/components/DocLink";
import { getNewExperimentDatasourceDefaults } from "@/components/Experiment/NewExperimentForm";
import NewFactTableSqlStep from "@/components/FactTables/NewFactTableSqlStep";
import Field from "@/components/Forms/Field";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getInitialFactTableQuery } from "@/services/datasources";
import {
  DATATYPE_OPTIONS,
  datatypeLabel,
  getNewFactTableProjects,
} from "@/services/factTables";
import track from "@/services/track";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import RadioGroup from "@/ui/RadioGroup";
import { Select, SelectItem } from "@/ui/Select";
import Table, { TableBody, TableCell, TableRow } from "@/ui/Table";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import Code from "@/components/SyntaxHighlighting/Code";
import Link from "@/ui/Link";

// Radix Select can't use an empty string as an item value
const NONE = "__none__";

// `user_id`, `userId`, and `USER_ID` all name the same thing
const normalizeIdentifier = (name: string) =>
  name.replace(/[^a-z]/gi, "").toLowerCase();

// Columns commonly used to tell one event type apart from another, which makes
// them the most useful default for an inline filter.
const INLINE_FILTER_CANDIDATES = [
  "event_name",
  "eventName",
  "event_type",
  "eventType",
  "event",
  "name",
  "type",
  "action",
];

// Mirrors numberFormatValidator. Deliberately has no default -- column
// metadata can't tell us whether a number is money, a duration, or a count.
const NUMBER_FORMAT_OPTIONS: { value: NumberFormat; label: string }[] = [
  { value: "", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "time:seconds", label: "Time (s)" },
  { value: "memory:bytes", label: "Memory (b)" },
  { value: "memory:kilobytes", label: "Memory (kb)" },
];

// Detection leaves these two behind when it can't pin a type down, so they are
// the only ones worth asking about.
const needsDatatypeChoice = (col: DetectedFactTableColumn) =>
  col.datatype === "" || col.datatype === "other";

// Room for the SQL step's editor, schema browser, and results panel. The
// configure step only uses it as a ceiling -- it sizes to its content.
const BODY_HEIGHT = "calc(93vh - 200px)";

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
  const [eventName, setEventName] = useState("");

  // Step 2 state
  const [detected, setDetected] = useState<DetectedFactTableColumn[] | null>(
    null,
  );
  const [detectedSql, setDetectedSql] = useState<string | null>(null);
  const [datatypes, setDatatypes] = useState<
    Record<string, FactTableColumnType>
  >({});
  const [name, setName] = useState("");
  const [timestampColumn, setTimestampColumn] = useState("");
  const [userIdColumns, setUserIdColumns] = useState<Record<string, string>>(
    {},
  );
  const [inlineFilterColumn, setInlineFilterColumn] = useState("");
  const [tableType, setTableType] = useState<FactTableType>("event");
  const [numberFormats, setNumberFormats] = useState<
    Record<string, NumberFormat>
  >({});

  // Set by the SQL step, so the modal's Next button can run the query first
  const validateSql = useRef<(() => Promise<void>) | null>(null);

  // Seed the editor with starter SQL for whichever Data Source is selected.
  // Keyed off a ref so a background definitions refresh can't wipe user edits.
  const seededDatasource = useRef<string | null>(null);
  useEffect(() => {
    if (seededDatasource.current === datasourceId) return;
    const datasource = getDatasourceById(datasourceId);
    if (!datasource) return;
    seededDatasource.current = datasourceId;
    setSql(getInitialFactTableQuery(datasource).sql);
  }, [datasourceId, getDatasourceById]);

  const datasource = getDatasourceById(datasourceId);
  const identifierTypes = (datasource?.settings?.userIdTypes || []).map(
    (t) => t.userIdType,
  );

  const datatypeFor = useCallback(
    (col: DetectedFactTableColumn): FactTableColumnType =>
      datatypes[col.column] ?? col.datatype,
    [datatypes],
  );

  const setDatatype = useCallback(
    (column: string, datatype: FactTableColumnType) =>
      setDatatypes((prev) => ({ ...prev, [column]: datatype })),
    [],
  );

  const setNumberFormat = useCallback(
    (column: string, numberFormat: NumberFormat) =>
      setNumberFormats((prev) => ({ ...prev, [column]: numberFormat })),
    [],
  );

  // Which columns each mapping can point at, matching what the API accepts.
  const timestampOptions = (detected || []).filter((c) =>
    ["date", "other", ""].includes(datatypeFor(c)),
  );
  const identifierOptions = (detected || []).filter((c) =>
    ["string", "number", "other", ""].includes(datatypeFor(c)),
  );
  // An event type is a low-cardinality string many rows share. A column named
  // like an id holds a value per row, so offering it would build a metric
  // filter whose dropdown lists every id in the table.
  const inlineFilterOptions = (detected || []).filter(
    (c) =>
      datatypeFor(c) === "string" &&
      !/id$/i.test(c.column) &&
      c.column !== timestampColumn &&
      !Object.values(userIdColumns).includes(c.column),
  );

  const activeIdTypes = identifierTypes.filter((t) => t in userIdColumns);
  const unusedIdTypes = identifierTypes.filter((t) => !(t in userIdColumns));
  if (!unusedIdTypes.includes("anonymous_id")) {
    unusedIdTypes.push("anonymous_id");
    unusedIdTypes.push("org_id");
  }

  const addIdentifier = (idType: string) =>
    setUserIdColumns((prev) => ({ ...prev, [idType]: "" }));

  const removeIdentifier = (idType: string) =>
    setUserIdColumns((prev) => {
      const next = { ...prev };
      delete next[idType];
      return next;
    });

  // Changing a column's data type (or reusing it for another mapping) can make
  // an earlier selection invalid. Treat those as unset everywhere rather than
  // sending a column the API will reject.
  const validColumn = (options: DetectedFactTableColumn[], column: string) =>
    options.some((c) => c.column === column) ? column : "";

  const handleColumnsDetected = useCallback(
    (columns: DetectedFactTableColumn[]) => {
      setDetectedSql(sql);

      // Always take the newest detection -- reading a row sample narrows types
      // the schema alone couldn't pin down. Manual overrides still win, since
      // datatypeFor prefers them.
      if (JSON.stringify(columns) !== JSON.stringify(detected)) {
        setDetected(columns);
      }

      // Only reset the form when the SQL returns a different set of columns.
      // Better types for the same columns leave the configuration alone.
      if (
        detected &&
        detected.length === columns.length &&
        detected.every((c, i) => c.column === columns[i].column)
      ) {
        return;
      }

      const idTypes = (
        getDatasourceById(datasourceId)?.settings?.userIdTypes || []
      ).map((t) => t.userIdType);

      setDatatypes({});
      setNumberFormats({});
      setTimestampColumn(
        columns.find((c) => c.datatype === "date")?.column || "",
      );
      setUserIdColumns(
        Object.fromEntries(
          idTypes.flatMap((idType) => {
            const match = columns.find(
              (c) =>
                normalizeIdentifier(c.column) === normalizeIdentifier(idType),
            );
            return match ? [[idType, match.column]] : [];
          }),
        ),
      );
      // An event-type column is the only table type signal the detected
      // columns give us. Nothing marks a rollup, so that stays a manual choice.
      const eventTypeColumn =
        INLINE_FILTER_CANDIDATES.find((candidate) =>
          columns.some(
            (c) => c.column === candidate && c.datatype === "string",
          ),
        ) || "";
      setInlineFilterColumn(eventTypeColumn);
      setTableType(eventTypeColumn ? "event" : "model");
    },
    [detected, sql, datasourceId, getDatasourceById],
  );

  async function submit() {
    if (!detected) throw new Error("Test your SQL first");
    if (!datasource) throw new Error("Select a valid Data Source");
    if (!name) throw new Error("Enter a name for this Fact Table");

    const timestamp = validColumn(timestampOptions, timestampColumn);
    if (!timestamp) throw new Error("Select a timestamp column");

    // Only an event stream has an event type column to inline filter on
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
      sql,
      eventName: eventName || name,
      tableType,
      userIdTypes,
      ...(Object.keys(remapped).length ? { userIdColumns: remapped } : {}),
      timestampColumn: timestamp,
      columns: detected.map((col) => {
        const datatype = datatypeFor(col);
        // A format left over from a column that used to be a number would
        // otherwise be sent for whatever type it is now
        const numberFormat =
          datatype === "number" ? numberFormats[col.column] : "";
        return {
          column: col.column,
          datatype,
          ...(col.jsonFields ? { jsonFields: col.jsonFields } : {}),
          ...(col.column === inlineFilter ? { alwaysInlineFilter: true } : {}),
          ...(numberFormat ? { numberFormat } : {}),
        };
      }),
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
      size={step === 0 ? "max" : "lg"}
      overflowAuto={false}
      // The SQL step focuses its own editor
      autoFocusSelector=""
      // Two steps with a Back button don't need a stepper
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
        <Box p="2" style={{ height: BODY_HEIGHT }}>
          <NewFactTableSqlStep
            datasourceId={datasourceId}
            setDatasourceId={setDatasourceId}
            sql={sql}
            setSql={setSql}
            eventName={eventName}
            setEventName={setEventName}
            detected={detected}
            detectedSql={detectedSql}
            onColumnsDetected={handleColumnsDetected}
            validateRef={validateSql}
          />
        </Box>
      </Page>

      <Page display="Configure">
        <Flex align="stretch" style={{ maxHeight: BODY_HEIGHT }} gap="4">
          <Box
            p="4"
            style={{
              flex: "0 0 320px",
              maxWidth: "50%",
              overflowY: "auto",
              // Three columns in 320px is tight once a row shows two selects
              overflowX: "auto",
              borderRight: "1px solid var(--gray-a3)",
              backgroundColor: "var(--slate-a2)",
            }}
          >
            <Flex direction="column" gap="4" style={{ height: "100%" }}>
              <Code
                language="sql"
                code={sql}
                expandable
                maxHeight="150px"
                filename={
                  <Link
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setStep(0);
                    }}
                  >
                    <PiArrowLeft className="mr-1" /> Edit SQL
                  </Link>
                }
              />
              <Separator size="4" />
              <Box>
                <Text as="div" weight="semibold" mb="1">
                  Detected columns
                </Text>
                <Table size="sm">
                  <TableBody>
                    {(detected || []).map((col) => (
                      <TableRow key={col.column}>
                        <TableCell>
                          <Text size="sm">{col.column}</Text>
                        </TableCell>
                        <TableCell style={{ width: 120 }}>
                          {needsDatatypeChoice(col) ? (
                            <Select
                              size="sm"
                              value={datatypeFor(col) || undefined}
                              setValue={(v) =>
                                setDatatype(
                                  col.column,
                                  v as FactTableColumnType,
                                )
                              }
                              variant="ghost"
                              placeholder="Unknown"
                              style={{
                                maxWidth: 110,
                              }}
                            >
                              {DATATYPE_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </Select>
                          ) : datatypeFor(col) === "number" ? (
                            <Select
                              size="sm"
                              value={numberFormats[col.column] || NONE}
                              setValue={(v) =>
                                setNumberFormat(
                                  col.column,
                                  v === NONE ? "" : (v as NumberFormat),
                                )
                              }
                              variant="ghost"
                              style={{
                                maxWidth: 110,
                              }}
                            >
                              {NUMBER_FORMAT_OPTIONS.map((o) => (
                                <SelectItem
                                  key={o.value || NONE}
                                  value={o.value || NONE}
                                >
                                  {o.label}
                                </SelectItem>
                              ))}
                            </Select>
                          ) : (
                            <Text color="text-mid" size="sm">
                              {datatypeLabel(datatypeFor(col))}
                            </Text>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Flex>
          </Box>
          <Box p="4" style={{ flex: 1, overflowY: "auto" }}>
            <Flex direction="column" gap="4" style={{ maxWidth: 480 }}>
              <Box>
                <Field
                  label="Fact Table name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
                <Select
                  label="Timestamp column"
                  value={
                    validColumn(timestampOptions, timestampColumn) || undefined
                  }
                  setValue={setTimestampColumn}
                  placeholder="Select a column..."
                >
                  {timestampOptions.map((c) => (
                    <SelectItem key={c.column} value={c.column}>
                      {c.column}
                    </SelectItem>
                  ))}
                </Select>
              </Box>

              <Box>
                <Text as="div" weight="semibold" mb="1">
                  Identifier columns
                </Text>
                <Frame py="3" px="3" mb="0">
                  {activeIdTypes.length ? (
                    activeIdTypes.map((idType) => (
                      <Flex key={idType} mb="3" align="center" gap="2">
                        <Text as="div" size="sm" weight="semibold">
                          {idType}
                        </Text>
                        <Box flexGrow="1" style={{ minWidth: 0 }}>
                          <Select
                            mb="0"
                            value={
                              validColumn(
                                identifierOptions,
                                userIdColumns[idType] || "",
                              ) || undefined
                            }
                            setValue={(v) => {
                              setUserIdColumns({
                                ...userIdColumns,
                                [idType]: v,
                              });
                              // An identifier column can't also be the event type
                              if (v === inlineFilterColumn) {
                                setInlineFilterColumn("");
                              }
                            }}
                            placeholder="Select a column..."
                          >
                            {identifierOptions.map((c) => (
                              <SelectItem key={c.column} value={c.column}>
                                {c.column}
                              </SelectItem>
                            ))}
                          </Select>
                        </Box>
                        <IconButton
                          variant="ghost"
                          color="gray"
                          onClick={() => removeIdentifier(idType)}
                          aria-label={`Remove ${idType}`}
                        >
                          <PiX />
                        </IconButton>
                      </Flex>
                    ))
                  ) : (
                    <Text as="div" size="sm" color="text-mid" mb="2">
                      At least one of the following identifiers are required:
                    </Text>
                  )}
                  {unusedIdTypes.length ? (
                    <Flex gap="2" wrap="wrap">
                      {unusedIdTypes.map((idType) => (
                        <Button
                          key={idType}
                          variant="ghost"
                          size="sm"
                          icon={<PiPlus />}
                          onClick={() => addIdentifier(idType)}
                        >
                          {idType}
                        </Button>
                      ))}
                    </Flex>
                  ) : null}
                </Frame>
              </Box>

              <Box>
                <Text as="div" weight="semibold" mb="2">
                  Table type
                </Text>
                <RadioGroup
                  value={tableType}
                  setValue={(v) => setTableType(v as FactTableType)}
                  gap="2"
                  options={[
                    {
                      value: "event",
                      label: "Event stream",
                      description: (
                        <>
                          Many event types differentiated by a column like{" "}
                          <strong>event_name</strong>
                        </>
                      ),
                      renderOutsideItem: true,
                      renderOnSelect: (
                        <Frame ml="5" mb="3" px="3" py="3">
                          <Select
                            label="Event type column"
                            labelSize="sm"
                            mb="0"
                            value={
                              validColumn(
                                inlineFilterOptions,
                                inlineFilterColumn,
                              ) || NONE
                            }
                            setValue={(v) =>
                              setInlineFilterColumn(v === NONE ? "" : v)
                            }
                          >
                            <SelectItem value={NONE}>None</SelectItem>
                            {inlineFilterOptions.map((c) => (
                              <SelectItem key={c.column} value={c.column}>
                                {c.column}
                              </SelectItem>
                            ))}
                          </Select>
                        </Frame>
                      ),
                    },
                    {
                      value: "model",
                      label: "Model",
                      description:
                        "Table for one specific object type: orders, signups, sessions, etc.",
                    },
                    {
                      value: "rollup",
                      label: "Daily rollup",
                      description: "Pre-aggregated, one row per user per day",
                      renderOutsideItem: true,
                      renderOnSelect: (
                        <Box ml="5" mt="1">
                          <Callout status="warning" size="sm">
                            Daily timestamps land at midnight, so each
                            user&apos;s first day of data falls before their
                            experiment exposure and gets dropped. Shift the
                            timestamp forward by one day in your SQL to keep it.{" "}
                            <DocLink docSection="preAggregatedTables">
                              View example
                            </DocLink>
                          </Callout>
                        </Box>
                      ),
                    },
                    {
                      value: "other",
                      label: "Other / Unknown",
                    },
                  ]}
                />
              </Box>
            </Flex>
          </Box>
        </Flex>
      </Page>
    </PagedModal>
  );
}
