import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiArrowLeft, PiPlus, PiX } from "react-icons/pi";
import {
  CreateFactTableProps,
  DetectedFactTableColumn,
  FactTableInterface,
  FactTableType,
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
import { getNewFactTableProjects } from "@/services/factTables";
import track from "@/services/track";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import RadioGroup from "@/ui/RadioGroup";
import { Select, SelectItem } from "@/ui/Select";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";
import Code from "@/components/SyntaxHighlighting/Code";
import Link from "@/ui/Link";

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
  const [name, setName] = useState("");
  const [timestampColumn, setTimestampColumn] = useState("");
  const [userIdColumns, setUserIdColumns] = useState<Record<string, string>>(
    {},
  );
  const [inlineFilterColumn, setInlineFilterColumn] = useState("");
  const [addingInlineFilter, setAddingInlineFilter] = useState(false);
  const [tableType, setTableType] = useState<FactTableType>("event");

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

  // Which columns each mapping can point at, matching what the API accepts.
  const timestampOptions = (detected || []).filter((c) =>
    ["date", "other", ""].includes(c.datatype),
  );
  const identifierOptions = (detected || []).filter((c) =>
    ["string", "number", "other", ""].includes(c.datatype),
  );
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
      setAddingInlineFilter(false);
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
      size={step === 0 ? "max" : "md"}
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
        <Box
          px="4"
          py="2"
          style={{ maxHeight: BODY_HEIGHT, overflowY: "auto" }}
        >
          <Flex direction="column" gap="2">
            <Code
              language="sql"
              code={sql}
              expandable
              collapsedLines={3}
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
            <Field
              label="Fact Table name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />

            <Box>
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

            <Table size="sm" variant="surface" layout="fixed" mb="2">
              <TableHeader>
                <TableRow>
                  <TableColumnHeader style={{ width: "50%" }}>
                    Column mapping
                  </TableColumnHeader>
                  <TableColumnHeader />
                  <TableColumnHeader style={{ width: 40 }} />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow align="center">
                  <TableCell>
                    <Text size="sm" weight="medium">
                      timestamp
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Select
                      size="sm"
                      mb="0"
                      value={
                        validColumn(timestampOptions, timestampColumn) ||
                        undefined
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
                  </TableCell>
                  <TableCell />
                </TableRow>
                {tableType === "event" ? (
                  <TableRow align="center">
                    <TableCell>
                      <Text size="sm" weight="medium">
                        event_name
                      </Text>
                    </TableCell>
                    {inlineFilterColumn || addingInlineFilter ? (
                      <>
                        <TableCell>
                          <Select
                            size="sm"
                            mb="0"
                            autoFocus={!inlineFilterColumn}
                            value={
                              validColumn(
                                inlineFilterOptions,
                                inlineFilterColumn,
                              ) || undefined
                            }
                            setValue={setInlineFilterColumn}
                            placeholder="Select a column..."
                          >
                            {inlineFilterOptions.map((c) => (
                              <SelectItem key={c.column} value={c.column}>
                                {c.column}
                              </SelectItem>
                            ))}
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Flex align="center">
                            <IconButton
                              variant="ghost"
                              color="gray"
                              size="1"
                              onClick={() => {
                                setInlineFilterColumn("");
                                setAddingInlineFilter(false);
                              }}
                              aria-label="Remove event_name column"
                            >
                              <PiX />
                            </IconButton>
                          </Flex>
                        </TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={2}>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<PiPlus />}
                          onClick={() => setAddingInlineFilter(true)}
                        >
                          column
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ) : null}
                {identifierTypes.map((idType) => (
                  <TableRow key={idType} align="center">
                    <TableCell>
                      <Text size="sm" weight="medium">
                        {idType}
                      </Text>
                    </TableCell>
                    {idType in userIdColumns ? (
                      <>
                        <TableCell>
                          <Select
                            size="sm"
                            mb="0"
                            // Only a row added by clicking the link starts
                            // empty, so this focuses just that one
                            autoFocus={!userIdColumns[idType]}
                            value={
                              validColumn(
                                identifierOptions,
                                userIdColumns[idType],
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
                        </TableCell>
                        <TableCell>
                          <Flex align="center">
                            <IconButton
                              variant="ghost"
                              color="gray"
                              size="1"
                              onClick={() => removeIdentifier(idType)}
                              aria-label={`Remove ${idType}`}
                            >
                              <PiX />
                            </IconButton>
                          </Flex>
                        </TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={2}>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<PiPlus />}
                          onClick={() => addIdentifier(idType)}
                        >
                          column
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Flex>
        </Box>
      </Page>
    </PagedModal>
  );
}
