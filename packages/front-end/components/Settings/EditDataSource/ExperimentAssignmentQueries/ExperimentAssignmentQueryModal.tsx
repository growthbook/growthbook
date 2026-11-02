import { useGrowthBook } from "@growthbook/growthbook-react";
import { useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowClockwise, PiArrowLeft } from "react-icons/pi";
import uniqId from "uniqid";
import omit from "lodash/omit";
import {
  findColumnsNeedingQuotes,
  getColumnsNeedingQuotesMessage,
  getExposureQueryExperimentIdColumn,
  getExposureQueryExperimentNameColumn,
  getExposureQueryIdentifierColumn,
  getExposureQueryIdentifierTypes,
  getExposureQueryTimestampColumn,
  getExposureQueryVariationIdColumn,
  getExposureQueryVariationNameColumn,
} from "shared/util";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
  ExposureQueryColumnMapping,
} from "shared/types/datasource";
import { DetectedColumn, FactTableColumnType } from "shared/types/fact-table";
import { getDataSourceSqlDialect } from "shared/dialects";
import SourceStep from "@/components/SchemaBrowser/SourceStep";
import { useSourceTable } from "@/components/SchemaBrowser/useSourceTable";
import ColumnMappingRow, {
  validColumn,
} from "@/components/SchemaBrowser/ColumnMappingRow";
import {
  findColumnByName,
  findEventTypeColumn,
  getColumnMappingError,
  getDefaultTimestampColumn,
  getRemappedUserIdColumns,
  rematchColumn,
  rematchUserIdColumns,
  isDimensionCandidate,
  isIdentifierCandidate,
  isTimestampCandidate,
} from "@/services/factTables";
import {
  getGA4ExposureTemplate,
  getStarterIdentifierTypes,
  getInitialExposureQuery,
  validateSQL,
} from "@/services/datasources";
import { useAuth } from "@/services/auth";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import { useDefinitions } from "@/services/DefinitionsContext";
import useProjectOptions from "@/hooks/useProjectOptions";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Code from "@/components/SyntaxHighlighting/Code";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import UITooltip from "@/ui/Tooltip";
import TextField from "@/ui/TextField";
import MultiSelectField from "@/ui/MultiSelectField";
import Table, { TableBody } from "@/ui/Table";

const BODY_HEIGHT = "calc(93vh - 200px)";

const getExposureQueryColumnMappingError = (
  columns: DetectedColumn[],
  fromTable?: boolean,
  savedTimestamp?: string,
) =>
  getColumnMappingError(
    // Like the mapping step, accept a saved timestamp whatever its type
    columns.map((c) =>
      c.column === savedTimestamp ? { ...c, datatype: "date" } : c,
    ),
    fromTable,
    {
      minColumns: 4,
      separateColumns:
        "separate columns for an experiment ID, a variation ID, a timestamp, and at least one identifier",
    },
  );

// In order of how often each type is used as a dimension, with the labels the
// fact table column editor uses
const DIMENSION_GROUP_LABELS: Record<FactTableColumnType, string> = {
  string: "String",
  boolean: "Boolean",
  number: "Number",
  "": "Unknown",
  date: "Date / Datetime",
  json: "JSON",
  binary: "Binary",
  other: "Other",
};

const ROLE_LABELS: Record<string, string> = {
  experiment_id: "Experiment ID",
  variation_id: "Variation ID",
  timestamp: "Timestamp",
  experiment_name: "Experiment name",
  variation_name: "Variation name",
};

// The columns each role reads from, keyed by role (identifier types by name).
function getRoleColumns(query: ExposureQuery): Record<string, string> {
  return {
    experiment_id: getExposureQueryExperimentIdColumn(query),
    variation_id: getExposureQueryVariationIdColumn(query),
    timestamp: getExposureQueryTimestampColumn(query),
    ...(query.hasNameCol
      ? {
          experiment_name: getExposureQueryExperimentNameColumn(query),
          variation_name: getExposureQueryVariationNameColumn(query),
        }
      : {}),
    ...Object.fromEntries(
      getExposureQueryIdentifierTypes(query).map((idType) => [
        idType,
        getExposureQueryIdentifierColumn(query, idType),
      ]),
    ),
  };
}

// Queries saved before detected columns were stored only tell us the columns
// they use, and not their types, until the columns are refreshed.
function getSavedColumns(query: ExposureQuery): DetectedColumn[] {
  if (query.columns?.length) return query.columns;
  const timestamp = getExposureQueryTimestampColumn(query);
  const known = new Set([
    ...Object.values(getRoleColumns(query)),
    ...query.dimensions,
  ]);
  return [...known].map((column) => ({
    column,
    datatype: column === timestamp ? "date" : "",
  }));
}

export const ExperimentAssignmentQueryModal = ({
  dataSource,
  exposureQuery,
  defaultIdentifierTypes,
  onSave,
  onCancel,
}: {
  dataSource: DataSourceInterfaceWithParams;
  exposureQuery?: ExposureQuery;
  // Identifiers a new query is meant to cover
  defaultIdentifierTypes?: string[];
  onSave: (exposureQuery: ExposureQuery) => Promise<void> | void;
  onCancel: () => void;
}) => {
  const { projects: allProjects } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const growthbook = useGrowthBook();

  const savedRoleColumns = exposureQuery ? getRoleColumns(exposureQuery) : {};
  const savedUserIdTypes = exposureQuery
    ? getExposureQueryIdentifierTypes(exposureQuery)
    : [];

  // Editing starts on the mapping, since most edits don't touch the SQL.
  const [step, setStep] = useState(exposureQuery ? 1 : 0);
  const [sql, setSql] = useState(
    () =>
      exposureQuery?.query ??
      getInitialExposureQuery(dataSource, defaultIdentifierTypes),
  );
  const [savedColumns] = useState(() =>
    exposureQuery ? getSavedColumns(exposureQuery) : null,
  );

  const [name, setName] = useState(exposureQuery?.name ?? "");
  const [description, setDescription] = useState(
    exposureQuery?.description ?? "",
  );
  const [projects, setProjects] = useState<string[]>(
    exposureQuery?.projects ?? [],
  );
  const [experimentIdColumn, setExperimentIdColumn] = useState(
    savedRoleColumns.experiment_id ?? "",
  );
  const [variationIdColumn, setVariationIdColumn] = useState(
    savedRoleColumns.variation_id ?? "",
  );
  const [timestampColumn, setTimestampColumn] = useState(
    savedRoleColumns.timestamp ?? "",
  );
  const [experimentNameColumn, setExperimentNameColumn] = useState(
    savedRoleColumns.experiment_name ?? "",
  );
  const [variationNameColumn, setVariationNameColumn] = useState(
    savedRoleColumns.variation_name ?? "",
  );
  const [userIdColumns, setUserIdColumns] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        savedUserIdTypes.map((idType) => [idType, savedRoleColumns[idType]]),
      ),
  );
  const [dimensions, setDimensions] = useState<string[]>(
    exposureQuery?.dimensions ?? [],
  );

  const [refreshingColumns, setRefreshingColumns] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const validateSql = useRef<(() => Promise<void>) | null>(null);

  const identifierTypes = useMemo(
    () => (dataSource.settings.userIdTypes || []).map((t) => t.userIdType),
    [dataSource],
  );
  const canRunQueries = permissionsUtil.canRunTestQueries(dataSource);
  const starterIdentifierTypes = getStarterIdentifierTypes(
    dataSource,
    defaultIdentifierTypes,
  );
  const [templates] = useState(() => [
    getGA4ExposureTemplate(starterIdentifierTypes),
  ]);

  const remapColumns = (cols: DetectedColumn[]) => {
    setExperimentIdColumn((prev) =>
      rematchColumn(prev, cols, () => findColumnByName(cols, "experiment_id")),
    );
    setVariationIdColumn((prev) =>
      rematchColumn(prev, cols, () => findColumnByName(cols, "variation_id")),
    );
    setTimestampColumn((prev) =>
      rematchColumn(prev, cols, () => getDefaultTimestampColumn(cols)),
    );
    setUserIdColumns((prev) =>
      rematchUserIdColumns(prev, identifierTypes, cols),
    );
    setExperimentNameColumn((prev) =>
      rematchColumn(prev, cols, () =>
        findColumnByName(cols, "experiment_name"),
      ),
    );
    setVariationNameColumn((prev) =>
      rematchColumn(prev, cols, () => findColumnByName(cols, "variation_name")),
    );
  };

  const getMappingError = (cols: DetectedColumn[], fromTable?: boolean) =>
    getExposureQueryColumnMappingError(
      cols,
      fromTable,
      savedRoleColumns.timestamp,
    );

  const source = useSourceTable({
    datasource: dataSource,
    // A saved query keeps only its SQL, so edits stay in SQL mode
    tableModeAvailable:
      !exposureQuery && growthbook.isOn("fact-table-table-mode"),
    templates,
    queryType: "exposureQueryTest",
    sql,
    setSql,
    initialColumns: savedColumns,
    getColumnMappingError: getMappingError,
    onSelectTable: (tableName) => {
      if (!name || name === source.tableName) setName(tableName);
      // Otherwise the previous table's mappings carry over
      setExperimentIdColumn("");
      setVariationIdColumn("");
      setTimestampColumn("");
      setUserIdColumns({});
      setExperimentNameColumn("");
      setVariationNameColumn("");
      setDimensions([]);
    },
    onColumnsChanged: remapColumns,
  });
  const { mode, selectedTable, partition, detected, querySql } = source;
  // A general events table is scanned in full unless filtered to exposures
  const eventTypeColumn =
    source.pickerColumns && !source.template
      ? findEventTypeColumn(source.pickerColumns)
      : "";
  const showEventTableHint =
    !!eventTypeColumn &&
    !source.rowFilters.some((f) => f.column === eventTypeColumn);
  // False while editing a query saved before its columns were stored, whose
  // columns are only guessed from its mapping
  const columnsDetected =
    !exposureQuery ||
    !!exposureQuery.columns?.length ||
    detected !== savedColumns;

  const columns = detected || [];
  // The old modal didn't check types, so a saved string timestamp stays listed
  const timestampOptions = columns.filter(
    (c) => isTimestampCandidate(c) || c.column === savedRoleColumns.timestamp,
  );
  const identifierOptions = columns.filter(isIdentifierCandidate);
  const columnsNeedingQuotes = findColumnsNeedingQuotes(
    {
      columnMapping: {
        experimentIdColumn,
        variationIdColumn,
        timestampColumn,
        experimentNameColumn,
        variationNameColumn,
        userIdColumns,
      },
    },
    getDataSourceSqlDialect(dataSource.type)?.unquotedIdentifierFold,
  );
  const experimentName = validColumn(columns, experimentNameColumn);
  const variationName = validColumn(columns, variationNameColumn);

  // Columns not claimed by a role are offered as dimensions. Already saved
  // dimensions stay listed so editing never silently drops one.
  const roleColumns = new Set(
    [
      experimentIdColumn,
      variationIdColumn,
      timestampColumn,
      ...Object.values(userIdColumns),
      experimentNameColumn,
      variationNameColumn,
    ].filter(Boolean),
  );
  const savedDimensions = exposureQuery?.dimensions ?? [];
  const dimensionColumns = columns.filter(
    (c) =>
      savedDimensions.includes(c.column) ||
      (!roleColumns.has(c.column) && isDimensionCandidate(c)),
  );
  const dimensionGroups = Object.entries(DIMENSION_GROUP_LABELS)
    .map(([type, label]) => ({
      label,
      options: dimensionColumns
        .filter((c) => c.datatype === type)
        .map((c) => c.column)
        .sort((a, b) => a.localeCompare(b))
        .map((column) => ({ label: column, value: column })),
    }))
    .filter((group) => group.options.length);
  // A lone group header adds nothing
  const dimensionOptions =
    dimensionGroups.length > 1
      ? dimensionGroups
      : dimensionGroups.flatMap((group) => group.options);

  const mappedUserIdTypes = identifierTypes.filter((t) =>
    validColumn(identifierOptions, userIdColumns[t] || ""),
  );
  const removedIdentifierTypes = savedUserIdTypes.filter(
    (idType) => !mappedUserIdTypes.includes(idType),
  );
  // Records saved before queries declared several identifiers store none and
  // analyze on this one.
  const removesLegacyIdentifierType =
    !!exposureQuery?.userIdType &&
    removedIdentifierTypes.includes(exposureQuery.userIdType);
  const missingRoleColumns = exposureQuery
    ? Object.entries({
        experiment_id: experimentIdColumn,
        variation_id: variationIdColumn,
        timestamp: timestampColumn,
        experiment_name: experimentNameColumn,
        variation_name: variationNameColumn,
        ...userIdColumns,
      }).filter(
        ([, column]) => column && !columns.some((c) => c.column === column),
      )
    : [];

  async function refreshColumns() {
    setRefreshingColumns(true);
    setRefreshError(null);
    try {
      validateSQL(sql, []);
      const res = await apiCall<{ error?: string; columns?: DetectedColumn[] }>(
        "/query/test",
        {
          method: "POST",
          body: JSON.stringify({
            query: sql,
            datasourceId: dataSource.id,
            limit: 0,
            detectColumns: true,
            queryType: "exposureQueryTest",
          }),
        },
      );
      if (res.error) throw new Error(res.error);
      const cols = res.columns || [];
      const error = getMappingError(cols);
      if (error) throw new Error(error);
      source.handleColumnsDetected(cols, sql);
    } catch (e) {
      setRefreshError(e.message);
    } finally {
      setRefreshingColumns(false);
    }
  }

  // Leaving the scope empty covers every Project the Data Source does.
  const canCoverAllProjects = permissionsUtil.canUpdateExposureQuery(
    { projects: [] },
    dataSource,
  );
  const projectOptions = useProjectOptions(
    (project) =>
      permissionsUtil.canUpdateExposureQuery(
        { projects: [project] },
        dataSource,
      ),
    projects,
    // Only the Data Source's Projects, plus any already selected so they can
    // be removed.
    allProjects.filter(
      (p) =>
        !dataSource.projects?.length ||
        dataSource.projects.includes(p.id) ||
        projects.includes(p.id),
    ),
  );

  async function submit() {
    if (!detected) throw new Error("Test your SQL first");
    if (!name) throw new Error("Enter a name for this assignment query");
    if (!canCoverAllProjects && !projects.length) {
      throw new Error(
        "Choose at least one Project. You don't have permission to edit assignment queries in every Project this Data Source covers.",
      );
    }

    const experimentId = validColumn(columns, experimentIdColumn);
    const variationId = validColumn(columns, variationIdColumn);
    const timestamp = validColumn(timestampOptions, timestampColumn);
    if (!experimentId) throw new Error("Select an experiment ID column");
    if (!variationId) throw new Error("Select a variation ID column");
    if (!timestamp) throw new Error("Select a timestamp column");

    if (!mappedUserIdTypes.length) {
      throw new Error("Map at least one identifier column");
    }
    // Imports read both names or neither
    if (!experimentName !== !variationName) {
      throw new Error(
        "Map both the experiment name and variation name columns, or neither.",
      );
    }
    const hasNameCol = !!experimentName && !!variationName;

    // The generated SQL can't tell roles apart when they share a column
    const mappedColumns = [
      experimentId,
      variationId,
      timestamp,
      ...mappedUserIdTypes.map((t) => userIdColumns[t]),
    ];
    const duplicate = mappedColumns.find(
      (c, i) => mappedColumns.indexOf(c) !== i,
    );
    if (duplicate) {
      throw new Error(
        `Column "${duplicate}" is mapped to more than one role. Each role must map to a distinct column.`,
      );
    }

    if (columnsNeedingQuotes.length) {
      throw new Error(getColumnsNeedingQuotesMessage(columnsNeedingQuotes));
    }

    const remappedUserIds = getRemappedUserIdColumns(
      mappedUserIdTypes,
      userIdColumns,
    );

    // Only roles whose column isn't the canonical name are stored
    const columnMapping: ExposureQueryColumnMapping = Object.fromEntries(
      Object.entries({
        userIdColumns: Object.keys(remappedUserIds).length
          ? remappedUserIds
          : undefined,
        timestampColumn: timestamp !== "timestamp" ? timestamp : undefined,
        experimentIdColumn:
          experimentId !== "experiment_id" ? experimentId : undefined,
        variationIdColumn:
          variationId !== "variation_id" ? variationId : undefined,
        experimentNameColumn:
          hasNameCol && experimentName !== "experiment_name"
            ? experimentName
            : undefined,
        variationNameColumn:
          hasNameCol && variationName !== "variation_name"
            ? variationName
            : undefined,
      }).filter(([, value]) => value !== undefined),
    );

    const saved: ExposureQuery = {
      // Keep fields this modal doesn't edit, but not a stale mapping.
      ...omit(exposureQuery ?? {}, "columnMapping"),
      id: exposureQuery?.id ?? uniqId("exq_"),
      name,
      description,
      // The server keeps a saved query's legacy identifier as is
      userIdType: exposureQuery?.userIdType || mappedUserIdTypes[0],
      userIdTypes: mappedUserIdTypes,
      query: querySql,
      dimensions: dimensions.filter((d) =>
        dimensionColumns.some((c) => c.column === d),
      ),
      hasNameCol,
      projects,
      // Mapping only offers top-level columns, so JSON fields aren't kept
      ...(columnsDetected
        ? {
            columns: columns.map(({ column, datatype }) => ({
              column,
              datatype,
            })),
          }
        : {}),
      ...(Object.keys(columnMapping).length ? { columnMapping } : {}),
    };

    await onSave(saved);
  }

  return (
    <PagedModal
      trackingEventModalType={
        exposureQuery
          ? "edit-experiment-assignment-query"
          : "new-experiment-assignment-query"
      }
      header={
        exposureQuery
          ? "Edit Experiment Assignment Query"
          : "Add Experiment Assignment Query"
      }
      step={step}
      setStep={setStep}
      submit={submit}
      close={onCancel}
      cta={exposureQuery ? "Save" : "Add"}
      size={step === 0 && mode === "sql" ? "max" : "lg"}
      disabledMessage={
        step === 0 && source.loadingColumns ? "Loading columns..." : undefined
      }
      ctaEnabled={step > 0 || source.canContinue}
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
            tableHint={
              showEventTableHint ? (
                <Callout status="info" size="sm">
                  This looks like an events table. Add a filter on{" "}
                  <code>{eventTypeColumn}</code>, like{" "}
                  <code>{eventTypeColumn} = &apos;experiment_viewed&apos;</code>
                  , so only exposure events are scanned.
                </Callout>
              ) : null
            }
            placeholder={`SELECT\n${starterIdentifierTypes
              .map((id) => `  ${id},\n`)
              .join(
                "",
              )}  timestamp,\n  experiment_id,\n  variation_id\nFROM\n  exposures`}
          />
        </Box>
      </Page>

      <Page display="Configure">
        <Box
          px="4"
          py="2"
          style={{ maxHeight: BODY_HEIGHT, overflowY: "auto" }}
        >
          <Flex direction="column" gap="3">
            {mode === "table" && selectedTable ? (
              <>
                <TextField
                  label="Source table"
                  value={selectedTable.path.replace(/`/g, "")}
                  readOnly
                  append={<Link onClick={() => setStep(0)}>Change</Link>}
                />
                {source.template ? (
                  <Callout status="info" size="sm">
                    GA4 events table detected. The{" "}
                    <code>experiment_viewed</code> events were selected
                    automatically.
                  </Callout>
                ) : null}
              </>
            ) : (
              <Code
                language="sql"
                code={querySql}
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
              label="Display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {allProjects.length > 0 && (
              <MultiSelectField
                label="Projects"
                placeholder={
                  canCoverAllProjects
                    ? "All Data Source Projects"
                    : "Choose Projects"
                }
                value={projects}
                options={projectOptions}
                onChange={setProjects}
                required={!canCoverAllProjects}
                helpText={
                  canCoverAllProjects
                    ? "Leave empty to use this Data Source's Projects."
                    : "Choose at least one Project."
                }
              />
            )}

            <Box>
              <Flex align="center" justify="between" mb="2">
                <Text as="div" weight="semibold">
                  Column mapping
                </Text>
                {exposureQuery ? (
                  <UITooltip
                    content="You don't have permission to run test queries"
                    enabled={!canRunQueries}
                  >
                    <span style={{ display: "inline-flex" }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<PiArrowClockwise />}
                        onClick={refreshColumns}
                        loading={refreshingColumns}
                        disabled={!canRunQueries || !sql}
                      >
                        Refresh columns
                      </Button>
                    </span>
                  </UITooltip>
                ) : null}
              </Flex>
              {!columnsDetected ? (
                <Callout status="info" mb="2">
                  Only the columns this query already uses are listed.
                  {canRunQueries
                    ? " Refresh columns to see everything it returns."
                    : ""}
                </Callout>
              ) : null}
              {refreshError ? (
                <Callout status="error" mb="2">
                  {refreshError}
                </Callout>
              ) : null}
              {missingRoleColumns.length > 0 ? (
                <Callout status="warning" mb="2">
                  {`Your query no longer returns ${missingRoleColumns
                    .map(
                      ([role, column]) =>
                        `"${column}" (${ROLE_LABELS[role] ?? role})`,
                    )
                    .join(", ")}. Choose a new column for each.`}
                </Callout>
              ) : null}
              <Table size="sm" variant="surface" layout="fixed" mb="2">
                <TableBody>
                  <ColumnMappingRow
                    label="Experiment ID"
                    kind="experiment"
                    value={experimentIdColumn}
                    options={columns}
                    setValue={setExperimentIdColumn}
                  />
                  <ColumnMappingRow
                    label="Variation ID"
                    kind="variation"
                    value={variationIdColumn}
                    options={columns}
                    setValue={setVariationIdColumn}
                  />
                  <ColumnMappingRow
                    label="Timestamp"
                    kind="timestamp"
                    tooltip="When the unit was exposed to the experiment"
                    value={timestampColumn}
                    options={timestampOptions}
                    setValue={setTimestampColumn}
                  />
                  {identifierTypes.map((idType) => (
                    <ColumnMappingRow
                      key={idType}
                      label={idType}
                      kind="identifier"
                      value={userIdColumns[idType] || ""}
                      options={identifierOptions}
                      setValue={(v) =>
                        setUserIdColumns((prev) => ({ ...prev, [idType]: v }))
                      }
                      onRemove={() =>
                        setUserIdColumns((prev) => omit(prev, idType))
                      }
                    />
                  ))}
                  <ColumnMappingRow
                    label="Experiment name"
                    kind="experiment"
                    tooltip="Display name for imported experiments. Map it with the variation name, or leave both empty."
                    value={experimentNameColumn}
                    options={columns}
                    setValue={setExperimentNameColumn}
                    onRemove={() => setExperimentNameColumn("")}
                  />
                  <ColumnMappingRow
                    label="Variation name"
                    kind="variation"
                    tooltip="Display name for imported variations. Map it with the experiment name, or leave both empty."
                    value={variationNameColumn}
                    options={columns}
                    setValue={setVariationNameColumn}
                    onRemove={() => setVariationNameColumn("")}
                  />
                  {mode === "table" &&
                  !source.template &&
                  partition.available ? (
                    <ColumnMappingRow
                      kind="partition"
                      label="Date partition"
                      tooltip="Only reads partitions from the experiment's start date on, to limit data scanned"
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
                </TableBody>
              </Table>
              {columnsNeedingQuotes.length ? (
                <Callout status="warning" size="sm" mb="2">
                  {getColumnsNeedingQuotesMessage(columnsNeedingQuotes)}
                </Callout>
              ) : null}
              {!experimentName !== !variationName ? (
                <Callout status="warning" size="sm" mb="2">
                  Map both the experiment name and the variation name, or leave
                  both empty.
                </Callout>
              ) : null}
              {removedIdentifierTypes.length > 0 ? (
                <Callout status="warning">
                  {`Experiments analyzed on ${removedIdentifierTypes
                    .map((idType) => `"${idType}"`)
                    .join(
                      ", ",
                    )} won't be able to update results until they're switched to another identifier.${
                    removesLegacyIdentifierType
                      ? ` Experiments, reports, and safe rollouts created before this query declared multiple identifiers also analyze on "${exposureQuery?.userIdType}". Adding it back restores them.`
                      : ""
                  }`}
                </Callout>
              ) : null}
            </Box>

            <MultiSelectField
              label="Dimension columns"
              placeholder="No dimensions"
              value={dimensions}
              options={dimensionOptions}
              sortOptions={false}
              onChange={setDimensions}
              helpText="Columns to break experiment results down by."
            />
          </Flex>
        </Box>
      </Page>
    </PagedModal>
  );
};
