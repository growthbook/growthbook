import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowLeft } from "react-icons/pi";
import { isProjectListValidForProject } from "shared/util";
import {
  CreateFactTableProps,
  DetectedFactTableColumn,
  FactTableColumnType,
  FactTableInterface,
} from "shared/types/fact-table";
import { getNewExperimentDatasourceDefaults } from "@/components/Experiment/NewExperimentForm";
import NewFactTableSqlStep from "@/components/FactTables/NewFactTableSqlStep";
import Field from "@/components/Forms/Field";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getInitialFactTableQuery } from "@/services/datasources";
import {
  DATATYPE_OPTIONS,
  getNewFactTableProjects,
} from "@/services/factTables";
import track from "@/services/track";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import LinkButton from "@/ui/LinkButton";
import { Select, SelectItem } from "@/ui/Select";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";

// Radix Select can't use an empty string as an item value
const NONE = "__none__";

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

export default function NewFactTablePage() {
  const router = useRouter();
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const {
    ready,
    datasources,
    project,
    projects,
    getDatasourceById,
    mutateDefinitions,
  } = useDefinitions();

  const validDatasources = datasources
    .filter((d) => isProjectListValidForProject(d.projects, project))
    .filter((d) => d.properties?.queryLanguage === "sql");

  const [step, setStep] = useState(0);
  const [datasourceId, setDatasourceId] = useState(
    () =>
      getNewExperimentDatasourceDefaults({ datasources, settings, project })
        .datasource,
  );
  const [sql, setSql] = useState("");
  const [eventName, setEventName] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    track("Viewed Create Fact Table Page");
  }, []);

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

  // Which columns each mapping can point at, matching what the API accepts.
  const timestampOptions = (detected || []).filter((c) =>
    ["date", "other", ""].includes(datatypeFor(c)),
  );
  const identifierOptions = (detected || []).filter((c) =>
    ["string", "number", "other", ""].includes(datatypeFor(c)),
  );
  const inlineFilterOptions = (detected || []).filter(
    (c) =>
      ["string", "boolean"].includes(datatypeFor(c)) &&
      c.column !== timestampColumn &&
      !Object.values(userIdColumns).includes(c.column),
  );

  // Changing a column's data type (or reusing it for another mapping) can make
  // an earlier selection invalid. Treat those as unset everywhere rather than
  // sending a column the API will reject.
  const validColumn = (options: DetectedFactTableColumn[], column: string) =>
    options.some((c) => c.column === column) ? column : "";

  const handleColumnsDetected = useCallback(
    (columns: DetectedFactTableColumn[]) => {
      setError(null);
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
      setTimestampColumn(
        columns.find((c) => c.datatype === "date")?.column || "",
      );
      setUserIdColumns(
        Object.fromEntries(
          idTypes
            .filter((idType) => columns.some((c) => c.column === idType))
            .map((idType) => [idType, idType]),
        ),
      );
      setInlineFilterColumn(
        INLINE_FILTER_CANDIDATES.find((candidate) =>
          columns.some(
            (c) => c.column === candidate && c.datatype === "string",
          ),
        ) || "",
      );
    },
    [detected, sql, datasourceId, getDatasourceById],
  );

  async function submit() {
    if (!detected) throw new Error("Run your SQL first");
    if (!datasource) throw new Error("Select a valid Data Source");
    if (!name) throw new Error("Enter a name for this Fact Table");

    const timestamp = validColumn(timestampOptions, timestampColumn);
    if (!timestamp) throw new Error("Select a timestamp column");

    const inlineFilter = validColumn(inlineFilterOptions, inlineFilterColumn);

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
      userIdTypes,
      ...(Object.keys(remapped).length ? { userIdColumns: remapped } : {}),
      timestampColumn: timestamp,
      columns: detected.map((col) => ({
        column: col.column,
        datatype: datatypeFor(col),
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

  if (!ready) return <LoadingOverlay />;

  const breadcrumb = (
    <PageHead
      breadcrumb={[
        { display: "Fact Tables", href: "/fact-tables" },
        { display: "New Fact Table" },
      ]}
    />
  );

  if (!permissionsUtil.canViewCreateFactTableModal(project, projects)) {
    return (
      <Box className="pagecontents container-fluid">
        {breadcrumb}
        <Callout status="error">
          You don&apos;t have permission to create Fact Tables
          {project ? " in this project" : ""}.
        </Callout>
      </Box>
    );
  }

  if (!validDatasources.length) {
    return (
      <Box className="pagecontents container-fluid">
        {breadcrumb}
        <Callout status="info" mb="3">
          Before creating a Fact Table, you must connect a SQL Data Source.
        </Callout>
        <LinkButton href="/datasources">Connect Data Source</LinkButton>
      </Box>
    );
  }

  return (
    <Box className="pagecontents container-fluid">
      {breadcrumb}
      <Flex align="center" gap="3" mb="4">
        {step === 1 && (
          <Button
            variant="ghost"
            size="md"
            icon={<PiArrowLeft />}
            onClick={() => setStep(0)}
          >
            Back
          </Button>
        )}
        <Heading as="h1" size="xl" mb="0">
          {step === 0 ? "New Fact Table" : "Configure Columns"}
        </Heading>
      </Flex>

      {error && (
        <Callout status="error" mb="3">
          {error}
        </Callout>
      )}

      {step === 0 ? (
        <Box style={{ height: "calc(100vh - 260px)", minHeight: 420 }}>
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
            onContinue={() => setStep(1)}
          />
        </Box>
      ) : (
        <>
          <Box mb="4" style={{ maxWidth: 480 }}>
            <Field
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
            <Select
              label="Timestamp column"
              mb="4"
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

            <Text as="div" weight="semibold" mb="1">
              Identifier columns
            </Text>
            <Text as="div" size="sm" color="text-mid" mb="2">
              Pick at least one. These let GrowthBook join this Fact Table to
              your experiment assignments.
            </Text>
            {identifierTypes.map((idType) => (
              <Select
                key={idType}
                label={idType}
                labelSize="sm"
                mb="3"
                value={
                  validColumn(identifierOptions, userIdColumns[idType] || "") ||
                  NONE
                }
                setValue={(v) => {
                  const column = v === NONE ? "" : v;
                  setUserIdColumns({ ...userIdColumns, [idType]: column });
                  // An identifier column can't also be an inline filter
                  if (column && column === inlineFilterColumn) {
                    setInlineFilterColumn("");
                  }
                }}
              >
                <SelectItem value={NONE}>Not in this Fact Table</SelectItem>
                {identifierOptions.map((c) => (
                  <SelectItem key={c.column} value={c.column}>
                    {c.column}
                  </SelectItem>
                ))}
              </Select>
            ))}

            <Select
              label="Inline filter column (optional)"
              mt="2"
              value={
                validColumn(inlineFilterOptions, inlineFilterColumn) || NONE
              }
              setValue={(v) => setInlineFilterColumn(v === NONE ? "" : v)}
            >
              <SelectItem value={NONE}>None</SelectItem>
              {inlineFilterOptions.map((c) => (
                <SelectItem key={c.column} value={c.column}>
                  {c.column}
                </SelectItem>
              ))}
            </Select>
            <Text as="div" size="sm" color="text-mid" mt="1">
              Metrics built on this Fact Table will prompt for a value from this
              column, e.g. the event name.
            </Text>
          </Box>

          <Box mb="4" style={{ maxWidth: 480 }}>
            <Text as="div" weight="semibold" mb="1">
              Column types
            </Text>
            <Text as="div" size="sm" color="text-mid" mb="2">
              Correct anything we got wrong, or set a type we couldn&apos;t
              detect. Types are re-checked in the background after saving.
            </Text>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableColumnHeader>Column</TableColumnHeader>
                  <TableColumnHeader>Data type</TableColumnHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detected || []).map((col) => (
                  <TableRow key={col.column}>
                    <TableCell>{col.column}</TableCell>
                    <TableCell>
                      <Select
                        size="sm"
                        value={datatypeFor(col) || undefined}
                        setValue={(v) =>
                          setDatatype(col.column, v as FactTableColumnType)
                        }
                        placeholder="Unknown"
                      >
                        {DATATYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>

          <Flex justify="end">
            <Button onClick={submit} setError={setError}>
              Create Fact Table
            </Button>
          </Flex>
        </>
      )}
    </Box>
  );
}
