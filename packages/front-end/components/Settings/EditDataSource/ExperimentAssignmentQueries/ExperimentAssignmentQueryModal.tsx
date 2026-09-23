import { useCallback, useRef, useState } from "react";
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
} from "shared/util";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "shared/types/datasource";
import { DetectedColumn } from "shared/types/fact-table";
import SqlColumnDetectionStep from "@/components/SchemaBrowser/SqlColumnDetectionStep";
import ColumnMappingRow, {
  validColumn,
} from "@/components/SchemaBrowser/ColumnMappingRow";
import {
  isIdentifierCandidate,
  isTimestampCandidate,
} from "@/services/factTables";
import { validateSQL } from "@/services/datasources";
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

const normalize = (name: string) => name.replace(/[^a-z]/gi, "").toLowerCase();

// An EAQ must return experiment id, variation id, timestamp, and at least one
// identifier column — so the query needs a date column plus a few others.
function getExposureQueryColumnMappingError(
  columns: DetectedColumn[],
): string | null {
  if (!columns.some(isTimestampCandidate)) {
    return "Your query must return a date column to use as the timestamp.";
  }
  if (!columns.some(isIdentifierCandidate)) {
    return "Your query must return a column to use as an identifier.";
  }
  if (columns.length < 4) {
    return "Your query must return separate columns for experiment id, variation id, timestamp, and at least one identifier.";
  }
  return null;
}

// The columns each role reads from, keyed by role label.
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
  onSave,
  onCancel,
}: {
  dataSource: DataSourceInterfaceWithParams;
  // Edits this query when set; otherwise creates a new one.
  exposureQuery?: ExposureQuery;
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
  const [sql, setSql] = useState(exposureQuery?.query ?? "");
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

  const identifierTypes = (dataSource.settings?.userIdTypes || []).map(
    (t) => t.userIdType,
  );
  const canRunQueries = permissionsUtil.canRunTestQueries(dataSource);

  const columns = detected || [];
  const timestampOptions = columns.filter(isTimestampCandidate);
  const identifierOptions = columns.filter(isIdentifierCandidate);
  const hasNameCol =
    columns.some((c) => c.column === "experiment_name") &&
    columns.some((c) => c.column === "variation_name");

  // Columns not claimed by a role are offered as dimensions.
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
  const dimensionOptions = columns
    .filter((c) => !roleColumns.has(c.column))
    .map((c) => ({ label: c.column, value: c.column }));

  const mappedUserIdTypes = identifierTypes.filter((t) =>
    validColumn(identifierOptions, userIdColumns[t] || ""),
  );
  const removedIdentifierTypes = savedUserIdTypes.filter(
    (idType) => !mappedUserIdTypes.includes(idType),
  );
  // Saved mappings whose column the SQL no longer returns.
  const missingRoleColumns = Object.entries(savedRoleColumns).filter(
    ([, column]) => !columns.some((c) => c.column === column),
  );

  const removeIdentifier = (idType: string) =>
    setUserIdColumns((prev) => {
      const next = { ...prev };
      delete next[idType];
      return next;
    });

  const handleColumnsDetected = useCallback(
    (cols: DetectedColumn[]) => {
      setDetectedSql(sql);
      setDetected(cols);

      // Same columns as before? Leave the user's mapping choices alone.
      if (
        detected &&
        detected.length === cols.length &&
        detected.every((c, i) => c.column === cols[i].column)
      ) {
        return;
      }

      const byName = (target: string) =>
        cols.find((c) => normalize(c.column) === normalize(target))?.column ||
        "";
      const exists = (column: string) => cols.some((c) => c.column === column);

      setExperimentIdColumn((prev) =>
        exists(prev) ? prev : byName("experiment_id"),
      );
      setVariationIdColumn((prev) =>
        exists(prev) ? prev : byName("variation_id"),
      );
      setTimestampColumn((prev) =>
        exists(prev)
          ? prev
          : cols.find((c) => c.datatype === "date")?.column ||
            byName("timestamp"),
      );
      setUserIdColumns((prev) =>
        Object.fromEntries(
          identifierTypes.flatMap((idType) => {
            const current = prev[idType];
            if (current && exists(current)) return [[idType, current]];
            const match = byName(idType);
            return match ? [[idType, match]] : [];
          }),
        ),
      );
    },
    // identifierTypes is derived from the fixed data source.
    [detected, sql, identifierTypes],
  );

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
      handleColumnsDetected(cols);
    } catch (e) {
      setRefreshError(e.message);
    } finally {
      setRefreshingColumns(false);
    }
  }

  const projectOptions = useProjectOptions(
    () => permissionsUtil.canUpdateDataSourceSettings(dataSource),
    projects,
    dataSource.projects?.length
      ? allProjects.filter(
          (p) => dataSource.projects?.includes(p.id) || projects.includes(p.id),
        )
      : undefined,
  );

  async function submit() {
    if (!detected) throw new Error("Test your SQL first");
    if (!name) throw new Error("Enter a name for this assignment query");

    const experimentId = validColumn(columns, experimentIdColumn);
    const variationId = validColumn(columns, variationIdColumn);
    const timestamp = validColumn(timestampOptions, timestampColumn);
    if (!experimentId) throw new Error("Select an experiment id column");
    if (!variationId) throw new Error("Select a variation id column");
    if (!timestamp) throw new Error("Select a timestamp column");

    const userIdTypes = mappedUserIdTypes;
    if (!userIdTypes.length) {
      throw new Error("Map at least one identifier column");
    }

    // A physical column can't play two roles (e.g. experiment id and variation
    // id) — that would make the generated SQL filter/group on the wrong thing.
    const mappedColumns = [
      experimentId,
      variationId,
      timestamp,
      ...userIdTypes.map((t) => userIdColumns[t]),
    ];
    const duplicate = mappedColumns.find(
      (c, i) => mappedColumns.indexOf(c) !== i,
    );
    if (duplicate) {
      throw new Error(
        `Column "${duplicate}" is mapped to more than one role. Each role must map to a distinct column.`,
      );
    }

    // Only store mappings that differ from the canonical role name; anything
    // named canonically resolves without a mapping.
    const remappedUserIds = Object.fromEntries(
      userIdTypes
        .filter((t) => userIdColumns[t] !== t)
        .map((t) => [t, userIdColumns[t]]),
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
      userIdType: userIdTypes[0],
      userIdTypes,
      query: sql,
      dimensions: dimensions.filter((d) => validColumn(columns, d)),
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
      size={step === 0 ? "max" : "lg"}
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
            Assignment queries must return experiment_id, variation_id, a
            timestamp, and at least one identifier column (
            {identifierTypes.join(", ")}).
          </Text>
        </Box>
        <Box p="2" style={{ height: BODY_HEIGHT }}>
          <SqlColumnDetectionStep
            datasourceId={dataSource.id}
            sql={sql}
            setSql={setSql}
            detected={detected}
            detectedSql={detectedSql}
            onColumnsDetected={handleColumnsDetected}
            validateRef={validateSql}
            getColumnMappingError={getExposureQueryColumnMappingError}
            placeholder={
              "SELECT\n  user_id,\n  timestamp,\n  experiment_id,\n  variation_id\nFROM\n  exposures"
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
          <Flex direction="column" gap="3">
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
                placeholder="All projects"
                value={projects}
                options={projectOptions}
                onChange={(v) => setProjects(v)}
                helpText="Limit this query to specific projects (a subset of the data source's projects)."
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
                    .map(([role, column]) => `"${column}" (${role})`)
                    .join(", ")}. Choose a new column for each.`}
                </Callout>
              ) : null}
              <Table size="sm" variant="surface" layout="fixed" mb="2">
                <TableBody>
                  <ColumnMappingRow
                    label="experiment_id"
                    value={experimentIdColumn}
                    options={columns}
                    setValue={setExperimentIdColumn}
                  />
                  <ColumnMappingRow
                    label="variation_id"
                    value={variationIdColumn}
                    options={columns}
                    setValue={setVariationIdColumn}
                  />
                  <ColumnMappingRow
                    label="timestamp"
                    kind="timestamp"
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
                      onRemove={() => removeIdentifier(idType)}
                    />
                  ))}
                </TableBody>
              </Table>
              {removedIdentifierTypes.length > 0 ? (
                <Callout status="warning">
                  {`Experiments analyzed on ${removedIdentifierTypes
                    .map((idType) => `"${idType}"`)
                    .join(
                      ", ",
                    )} won't be able to update results until they're switched to another identifier.`}
                </Callout>
              ) : null}
            </Box>

            <MultiSelectField
              label="Dimension columns"
              placeholder="No dimensions"
              value={dimensions}
              options={dimensionOptions}
              onChange={(v) => setDimensions(v)}
              helpText="Columns to break experiment results down by."
            />
          </Flex>
        </Box>
      </Page>
    </PagedModal>
  );
};
