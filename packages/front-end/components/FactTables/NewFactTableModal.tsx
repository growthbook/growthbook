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
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getInitialFactTableQuery } from "@/services/datasources";
import {
  getNewFactTableProjects,
  isIdentifierCandidate,
  isTimestampCandidate,
} from "@/services/factTables";
import track from "@/services/track";
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
    (columns: DetectedFactTableColumn[]) => {
      setDetectedSql(sql);
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
        exists(prev)
          ? prev
          : columns.find((c) => c.datatype === "date")?.column || "",
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
    [detected, sql, datasource],
  );

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
      sql,
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
      size={step === 0 ? "max" : "md"}
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
        <Box px="2" py="1">
          <Text>
            Fact Tables must select a timestamp column and at least one
            identifier column ({identifierTypes.join(", ")}).
          </Text>
        </Box>
        <Box p="2" style={{ height: BODY_HEIGHT }}>
          <NewFactTableSqlStep
            datasourceId={datasourceId}
            setDatasourceId={setDatasourceId}
            sql={sql}
            setSql={setSql}
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
                <Link onClick={() => setStep(0)}>
                  <Flex align="center" gap="1">
                    <PiArrowLeft /> Edit SQL
                  </Flex>
                </Link>
              }
            />
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
