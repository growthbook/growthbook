import { useCallback, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowClockwise, PiArrowLeft } from "react-icons/pi";
import uniqId from "uniqid";
import omit from "lodash/omit";
import {
  getExposureQueryExperimentIdColumn,
  getExposureQueryIdentifierColumn,
  getExposureQueryIdentifierTypes,
  getExposureQueryTimestampColumn,
  getExposureQueryVariationIdColumn,
  getUnquotableExposureQueryColumn,
} from "shared/util";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "shared/types/datasource";
import { DetectedColumn } from "shared/types/fact-table";
import { getDataSourceSqlDialect } from "shared/dialects";
import SourceStep from "@/components/SchemaBrowser/SourceStep";
import { useSourceTable } from "@/components/SchemaBrowser/useSourceTable";
import ColumnMappingRow, {
  validColumn,
} from "@/components/SchemaBrowser/ColumnMappingRow";
import {
  findColumnByName,
  getDefaultTimestampColumn,
  getRemappedUserIdColumns,
  haveSameColumnNames,
  isDimensionCandidate,
  isIdentifierCandidate,
  isTimestampCandidate,
} from "@/services/factTables";
import {
  GA4_EXPOSURE_TEMPLATE,
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
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import MultiSelectField from "@/ui/MultiSelectField";
import Table, { TableBody } from "@/ui/Table";

const BODY_HEIGHT = "calc(93vh - 200px)";
const TEMPLATES = [GA4_EXPOSURE_TEMPLATE];

function getExposureQueryColumnMappingError(
  columns: DetectedColumn[],
  fromTable = false,
): string | null {
  if (!columns.some(isTimestampCandidate)) {
    return fromTable
      ? "Selected table does not have a date column to use as the timestamp."
      : "Your query must return a date column to use as the timestamp.";
  }
  if (!columns.some(isIdentifierCandidate)) {
    return fromTable
      ? "Selected table does not have a column to use as an identifier."
      : "Your query must return a column to use as an identifier.";
  }
  if (columns.length < 4) {
    return fromTable
      ? "Selected table must have separate columns for experiment id, variation id, timestamp, and at least one identifier."
      : "Your query must return separate columns for experiment id, variation id, timestamp, and at least one identifier.";
  }
  return null;
}

const ROLE_LABELS: Record<string, string> = {
  experiment_id: "Experiment ID",
  variation_id: "Variation ID",
  timestamp: "Timestamp",
};

// The columns each role reads from, keyed by role (identifier types by name).
function getRoleColumns(query: ExposureQuery): Record<string, string> {
  return {
    experiment_id: getExposureQueryExperimentIdColumn(query),
    variation_id: getExposureQueryVariationIdColumn(query),
    timestamp: getExposureQueryTimestampColumn(query),
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
    ...(query.hasNameCol ? ["experiment_name", "variation_name"] : []),
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
  // Edits this query when set; otherwise creates a new one.
  exposureQuery?: ExposureQuery;
  // Identifiers a new query is meant to cover
  defaultIdentifierTypes?: string[];
  onSave: (exposureQuery: ExposureQuery) => Promise<void> | void;
  onCancel: () => void;
}) => {
  const { projects: allProjects } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();

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
  const [detected, setDetected] = useState<DetectedColumn[] | null>(() =>
    exposureQuery ? getSavedColumns(exposureQuery) : null,
  );
  const [detectedSql, setDetectedSql] = useState<string | null>(
    exposureQuery?.query ?? null,
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
  const placeholderIdentifierTypes = defaultIdentifierTypes?.length
    ? defaultIdentifierTypes
    : identifierTypes.slice(0, 1);

  const columns = detected || [];
  const timestampOptions = columns.filter(isTimestampCandidate);
  const identifierOptions = columns.filter(isIdentifierCandidate);
  const hasNameCol =
    columns.some((c) => c.column === "experiment_name") &&
    columns.some((c) => c.column === "variation_name");

  // String columns not claimed by a role are offered as dimensions. Already
  // saved dimensions stay listed so editing never silently drops one.
  const roleColumns = new Set(
    [
      experimentIdColumn,
      variationIdColumn,
      timestampColumn,
      ...Object.values(userIdColumns),
      "experiment_name",
      "variation_name",
    ].filter(Boolean),
  );
  const savedDimensions = exposureQuery?.dimensions ?? [];
  const dimensionOptions = columns
    .filter(
      (c) =>
        !roleColumns.has(c.column) &&
        (isDimensionCandidate(c) || savedDimensions.includes(c.column)),
    )
    .map((c) => ({ label: c.column, value: c.column }));

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
  const missingRoleColumns = Object.entries(savedRoleColumns).filter(
    ([, column]) => !columns.some((c) => c.column === column),
  );

  const handleColumnsDetected = useCallback(
    (cols: DetectedColumn[], ranSql: string | null = null) => {
      setDetectedSql(ranSql);
      setDetected(cols);

      // Same columns as before? Leave the user's mapping choices alone.
      if (detected && haveSameColumnNames(detected, cols)) return;

      const exists = (column: string) => cols.some((c) => c.column === column);

      setExperimentIdColumn((prev) =>
        exists(prev) ? prev : findColumnByName(cols, "experiment_id"),
      );
      setVariationIdColumn((prev) =>
        exists(prev) ? prev : findColumnByName(cols, "variation_id"),
      );
      setTimestampColumn((prev) =>
        exists(prev) ? prev : getDefaultTimestampColumn(cols),
      );
      setUserIdColumns((prev) =>
        Object.fromEntries(
          identifierTypes.flatMap((idType) => {
            const current = prev[idType];
            if (current && exists(current)) return [[idType, current]];
            const match = findColumnByName(cols, idType);
            return match ? [[idType, match]] : [];
          }),
        ),
      );
    },
    [detected, identifierTypes],
  );

  const source = useSourceTable({
    datasource: dataSource,
    // A saved query keeps only its SQL, so edits stay in SQL mode
    tableModeAvailable: !exposureQuery,
    templates: TEMPLATES,
    setSql,
    onSelectTable: (tableName) => {
      if (!name || name === source.tableName) setName(tableName);
      // Otherwise the previous table's mappings carry over
      setDetected(null);
      setExperimentIdColumn("");
      setVariationIdColumn("");
      setTimestampColumn("");
      setUserIdColumns({});
      setDimensions([]);
    },
    onColumnsDetected: handleColumnsDetected,
  });
  const { mode, selectedTable, pickerColumns, partition } = source;
  const querySql = mode === "table" ? source.tableSql : sql;

  const hasFreshResults = detectedSql === querySql && !!detected?.length;
  const columnError =
    mode === "table"
      ? pickerColumns
        ? getExposureQueryColumnMappingError(pickerColumns, true)
        : null
      : hasFreshResults && detected
        ? getExposureQueryColumnMappingError(detected)
        : null;

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
          }),
        },
      );
      if (res.error) throw new Error(res.error);
      const cols = res.columns || [];
      const error = getExposureQueryColumnMappingError(cols);
      if (error) throw new Error(error);
      handleColumnsDetected(cols, sql);
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
    if (!experimentId) throw new Error("Select an experiment id column");
    if (!variationId) throw new Error("Select a variation id column");
    if (!timestamp) throw new Error("Select a timestamp column");

    if (!mappedUserIdTypes.length) {
      throw new Error("Map at least one identifier column");
    }

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
    const unquotable = getUnquotableExposureQueryColumn(
      {
        experimentIdColumn: experimentId,
        variationIdColumn: variationId,
        timestampColumn: timestamp,
        userIdColumns,
      },
      getDataSourceSqlDialect(dataSource.type)?.unquotedIdentifierFold,
    );
    if (unquotable) {
      throw new Error(
        `Column "${unquotable}" can't be mapped because its name needs quoting. In SQL mode, alias it to an unquoted name.`,
      );
    }

    const remappedUserIds = getRemappedUserIdColumns(
      mappedUserIdTypes,
      userIdColumns,
    );

    const saved: ExposureQuery = {
      // Keep fields this modal doesn't edit, but not stale mappings.
      ...omit(exposureQuery ?? {}, [
        "userIdColumns",
        "timestampColumn",
        "experimentIdColumn",
        "variationIdColumn",
      ]),
      id: exposureQuery?.id ?? uniqId("exq_"),
      name,
      description,
      // The server keeps a saved query's legacy identifier as is
      userIdType: exposureQuery?.userIdType || mappedUserIdTypes[0],
      userIdTypes: mappedUserIdTypes,
      query: querySql,
      dimensions: dimensions.filter((d) =>
        dimensionOptions.some((o) => o.value === d),
      ),
      hasNameCol,
      projects,
      columns,
      ...(Object.keys(remappedUserIds).length
        ? { userIdColumns: remappedUserIds }
        : {}),
      ...(timestamp !== "timestamp" ? { timestampColumn: timestamp } : {}),
      ...(experimentId !== "experiment_id"
        ? { experimentIdColumn: experimentId }
        : {}),
      ...(variationId !== "variation_id"
        ? { variationIdColumn: variationId }
        : {}),
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
      ctaEnabled={
        step > 0 ||
        (!columnError &&
          (mode === "sql" ||
            (!!pickerColumns && source.rowFilterWhere !== null)))
      }
      overflowAuto={false}
      autoFocusSelector=""
      hideNav
      bodyClassName="p-0"
      backButton
      onBackFirstStep={
        mode === "sql" && source.tableModeAvailable
          ? () => source.setMode("table")
          : undefined
      }
    >
      <Page
        display="Write SQL"
        validate={async () => {
          await validateSql.current?.();
        }}
      >
        {mode === "sql" ? (
          <Box px="2" py="1">
            <Text>
              Assignment queries must return experiment_id, variation_id, a
              timestamp, and at least one identifier column (
              {identifierTypes.join(", ")}).
            </Text>
          </Box>
        ) : null}
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
            datasourceId={dataSource.id}
            sql={querySql}
            setSql={setSql}
            detected={detected}
            hasFreshResults={hasFreshResults}
            onColumnsDetected={handleColumnsDetected}
            validateRef={validateSql}
            columnError={columnError}
            getColumnMappingError={getExposureQueryColumnMappingError}
            queryType="exposureQueryTest"
            placeholder={`SELECT\n${placeholderIdentifierTypes
              .map((id) => `  ${id},\n`)
              .join(
                "",
              )}  timestamp,\n  experiment_id,\n  variation_id\nFROM\n  exposures`}
            source={source}
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
              <TextField
                label="Source table"
                value={selectedTable.path.replace(/`/g, "")}
                readOnly
                append={<Link onClick={() => setStep(0)}>Change</Link>}
                helpText={
                  !source.template && partition.column ? (
                    <>
                      Filtered on partition column{" "}
                      <code>{partition.column}</code> to limit data scanned.
                    </>
                  ) : undefined
                }
              />
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
                ) : null}
              </Flex>
              {exposureQuery && !exposureQuery.columns?.length ? (
                <Callout status="info" mb="2">
                  Only the columns this query already uses are listed. Refresh
                  columns to see everything it returns.
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
                </TableBody>
              </Table>
              {mode === "table" && source.template ? (
                <Callout status="info" size="sm" mb="2">
                  GA4 events table detected. The experiment_viewed events were
                  selected automatically.
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
              onChange={setDimensions}
              helpText="Columns to break experiment results down by."
            />
          </Flex>
        </Box>
      </Page>
    </PagedModal>
  );
};
