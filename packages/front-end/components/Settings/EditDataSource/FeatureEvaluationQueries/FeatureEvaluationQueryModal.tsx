import { useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowClockwise, PiArrowLeft } from "react-icons/pi";
import uniqId from "uniqid";
import omit from "lodash/omit";
import {
  findFeatureUsageColumnsNeedingQuotes,
  getColumnsNeedingQuotesMessage,
  getFeatureUsageEnvironmentColumn,
  getFeatureUsageFeatureKeyColumn,
  getFeatureUsageIdentifierColumn,
  getFeatureUsageJsonFieldError,
  getFeatureUsageRevisionColumn,
  getFeatureUsageRuleIdColumn,
  getFeatureUsageSourceColumn,
  getFeatureUsageTimestampColumn,
  getFeatureUsageValueColumn,
  getFeatureUsageVariationIdColumn,
  FEATURE_USAGE_JSON_ROOT_TYPES,
  splitFeatureUsageJsonField,
} from "shared/util";
import {
  DataSourceInterfaceWithParams,
  FeatureUsageQuery,
  FeatureUsageQueryColumnMapping,
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
  isIdentifierCandidate,
  isTimestampCandidate,
  rematchColumn,
  rematchUserIdColumns,
  SourceTableTemplate,
} from "@/services/factTables";
import { validateSQL } from "@/services/datasources";
import { useAttributeSchema } from "@/services/features";
import { useAuth } from "@/services/auth";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Code from "@/components/SyntaxHighlighting/Code";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import UITooltip from "@/ui/Tooltip";
import TextField from "@/ui/TextField";
import Table, { TableBody } from "@/ui/Table";

const BODY_HEIGHT = "calc(93vh - 200px)";

// Text columns with these names usually hold the SDK's attributes as JSON
const ATTRIBUTE_COLUMN_NAMES = [
  "attributes",
  "context",
  "context_json",
  "properties",
  "properties_json",
];

const isJsonRoot = (c: DetectedColumn, root: string) =>
  c.column === root && FEATURE_USAGE_JSON_ROOT_TYPES.includes(c.datatype);

// No known evaluation-table layouts to recognize yet
const NO_TEMPLATES: SourceTableTemplate[] = [];

const DEFAULT_QUERY = `SELECT\n  timestamp,\n  feature_key,\n  environment,\n  value\nFROM feature_usage`;

// Standard columns other than the timestamp and identifiers, with their
// standard names, the names a column is matched on, and what each enables
const OPTIONAL_ROLES = [
  {
    key: "environment",
    label: "Environment",
    names: ["environment", "env"],
    tooltip: "Lets you filter evaluations by environment",
    getColumn: getFeatureUsageEnvironmentColumn,
  },
  {
    key: "value",
    label: "Value",
    names: ["value"],
    tooltip: "Lets you break down and filter evaluations by value",
    getColumn: getFeatureUsageValueColumn,
  },
  {
    key: "rule_id",
    label: "Rule ID",
    names: ["rule_id"],
    tooltip: "Lets you see which rule served each evaluation",
    getColumn: getFeatureUsageRuleIdColumn,
  },
  {
    key: "variation_id",
    label: "Variation ID",
    names: ["variation_id"],
    tooltip: "Lets you see which experiment variation was served",
    getColumn: getFeatureUsageVariationIdColumn,
  },
  {
    key: "source",
    label: "Source",
    names: ["source"],
    tooltip:
      "Lets you see why each value was served, like a rule or the default",
    getColumn: getFeatureUsageSourceColumn,
  },
  {
    key: "revision",
    label: "Revision",
    names: ["revision"],
    tooltip: "Lets you see which revision of the flag was served",
    getColumn: getFeatureUsageRevisionColumn,
  },
] as const;

type OptionalRole = (typeof OPTIONAL_ROLES)[number]["key"];

const MAPPING_KEYS: Record<
  OptionalRole,
  keyof Omit<FeatureUsageQueryColumnMapping, "userIdColumns">
> = {
  environment: "environmentColumn",
  value: "valueColumn",
  rule_id: "ruleIdColumn",
  variation_id: "variationIdColumn",
  source: "sourceColumn",
  revision: "revisionColumn",
};

function getFeatureUsageColumnMappingError(
  columns: DetectedColumn[],
  fromTable?: boolean,
): string | null {
  if (!columns.some(isTimestampCandidate)) {
    return fromTable
      ? "Selected table does not have a timestamp column."
      : "Your query must return a date column to use as the timestamp.";
  }
  if (!columns.some(isIdentifierCandidate)) {
    return fromTable
      ? "Selected table does not have a column for the feature key."
      : "Your query must return a string column to use as the feature key.";
  }
  if (columns.length < 2) {
    return fromTable
      ? "Selected table must have separate timestamp and feature key columns."
      : "Your query must return separate timestamp and feature key columns.";
  }
  return null;
}

// The column each standard column and identifier type reads from
function getSavedRoleColumns(query: FeatureUsageQuery): Record<string, string> {
  const mapping = query.columnMapping ?? {};
  return {
    timestamp: getFeatureUsageTimestampColumn(query),
    feature_key: getFeatureUsageFeatureKeyColumn(query),
    // An optional column is used when it's mapped, or when the query returns
    // its standard name
    ...Object.fromEntries(
      OPTIONAL_ROLES.filter(
        ({ key }) =>
          !!mapping[MAPPING_KEYS[key]] ||
          !!query.columns?.some((c) => c.column === key),
      ).map(({ key, getColumn }) => [key, getColumn(query)]),
    ),
    ...Object.fromEntries(
      (query.userIdTypes ?? []).map((type) => [
        type,
        getFeatureUsageIdentifierColumn(query, type),
      ]),
    ),
  };
}

// Queries saved before detected columns were stored only tell us the columns
// they use, and not their types, until the columns are refreshed.
function getSavedColumns(query: FeatureUsageQuery): DetectedColumn[] {
  if (query.columns?.length) return query.columns;
  const timestamp = getFeatureUsageTimestampColumn(query);
  const known = new Set([
    timestamp,
    getFeatureUsageFeatureKeyColumn(query),
    ...(query.userIdTypes ?? []).map(
      (type) =>
        splitFeatureUsageJsonField(getFeatureUsageIdentifierColumn(query, type))
          ?.root ?? getFeatureUsageIdentifierColumn(query, type),
    ),
  ]);
  return [...known].map((column) => ({
    column,
    datatype: column === timestamp ? "date" : "",
  }));
}

export const FeatureEvaluationQueryModal = ({
  featureUsageQuery,
  dataSource,
  onSave,
  onCancel,
}: {
  featureUsageQuery?: FeatureUsageQuery;
  dataSource: DataSourceInterfaceWithParams;
  onSave: (featureUsageQuery: FeatureUsageQuery) => Promise<void>;
  onCancel: () => void;
}) => {
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const attributes = useAttributeSchema(false);

  const savedRoleColumns = featureUsageQuery
    ? getSavedRoleColumns(featureUsageQuery)
    : {};
  const savedUserIdTypes = featureUsageQuery?.userIdTypes ?? [];

  // Editing starts on the mapping, since most edits don't touch the SQL.
  const [step, setStep] = useState(featureUsageQuery ? 1 : 0);
  const [sql, setSql] = useState(
    () => featureUsageQuery?.query ?? DEFAULT_QUERY,
  );
  const [savedColumns] = useState(() =>
    featureUsageQuery ? getSavedColumns(featureUsageQuery) : null,
  );

  const [timestampColumn, setTimestampColumn] = useState(
    savedRoleColumns.timestamp ?? "",
  );
  const [featureKeyColumn, setFeatureKeyColumn] = useState(
    savedRoleColumns.feature_key ?? "",
  );
  const [optionalColumns, setOptionalColumns] = useState<
    Partial<Record<OptionalRole, string>>
  >(() =>
    Object.fromEntries(
      OPTIONAL_ROLES.filter(({ key }) => savedRoleColumns[key]).map(
        ({ key }) => [key, savedRoleColumns[key]],
      ),
    ),
  );
  const [userIdColumns, setUserIdColumns] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        savedUserIdTypes.map((idType) => [idType, savedRoleColumns[idType]]),
      ),
  );
  const [refreshingColumns, setRefreshingColumns] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const validateSql = useRef<(() => Promise<void>) | null>(null);

  const identifierTypes = useMemo(
    () => (dataSource.settings.userIdTypes || []).map((t) => t.userIdType),
    [dataSource],
  );
  const canRunQueries = permissionsUtil.canRunTestQueries(dataSource);

  const remapColumns = (cols: DetectedColumn[]) => {
    setTimestampColumn((prev) =>
      rematchColumn(prev, cols, () => getDefaultTimestampColumn(cols)),
    );
    setFeatureKeyColumn((prev) =>
      rematchColumn(
        prev,
        cols,
        () =>
          findColumnByName(cols, "feature_key") ||
          findColumnByName(cols, "feature"),
      ),
    );
    setOptionalColumns((prev) =>
      Object.fromEntries(
        OPTIONAL_ROLES.map(({ key, names }) => [
          key,
          rematchColumn(
            prev[key] ?? "",
            cols,
            () =>
              names.map((n) => findColumnByName(cols, n)).find(Boolean) ?? "",
          ),
        ]).filter(([, column]) => column),
      ),
    );
    setUserIdColumns((prev) => {
      const rematched = rematchUserIdColumns(prev, identifierTypes, cols);
      // rematchUserIdColumns only keeps fields of JSON-typed columns; a field
      // of a text column holding JSON survives too
      const keptFields = Object.fromEntries(
        Object.entries(prev).filter(([, column]) => {
          const parts = splitFeatureUsageJsonField(column);
          return parts && cols.some((c) => isJsonRoot(c, parts.root));
        }),
      );
      return { ...rematched, ...keptFields };
    });
  };

  const source = useSourceTable({
    datasource: dataSource,
    // A saved query keeps only its SQL, so edits stay in SQL mode
    tableModeAvailable: !featureUsageQuery,
    templates: NO_TEMPLATES,
    queryType: "featureUsageQueryTest",
    sql,
    setSql,
    initialColumns: savedColumns,
    getColumnMappingError: getFeatureUsageColumnMappingError,
    onSelectTable: () => {
      // Otherwise the previous table's mappings carry over
      setTimestampColumn("");
      setFeatureKeyColumn("");
      setOptionalColumns({});
      setUserIdColumns({});
    },
    onColumnsChanged: remapColumns,
  });
  const { mode, selectedTable, partition, detected, querySql } = source;
  // False while editing a query saved before its columns were stored, whose
  // columns are only guessed from its mapping
  const columnsDetected =
    !featureUsageQuery ||
    !!featureUsageQuery.columns?.length ||
    detected !== savedColumns;

  const columns: DetectedColumn[] = detected || [];
  const timestampOptions = columns.filter(
    (c) => isTimestampCandidate(c) || c.column === savedRoleColumns.timestamp,
  );
  const stringOptions = columns.filter(isIdentifierCandidate);
  // Columns a typed JSON field can be read from
  const jsonRootNames = columns
    .filter((c) => FEATURE_USAGE_JSON_ROOT_TYPES.includes(c.datatype))
    .map((c) => c.column);
  // Identifiers can also be a field inside a JSON column; the org's attributes
  // are the fields the SDK sends. They're suggested for JSON columns and for
  // text columns named like they hold attributes.
  const suggestedRoots = columns
    .filter(
      (c) =>
        c.datatype === "json" ||
        (FEATURE_USAGE_JSON_ROOT_TYPES.includes(c.datatype) &&
          ATTRIBUTE_COLUMN_NAMES.includes(c.column.toLowerCase())),
    )
    .map((c) => c.column);
  const identifierOptions: DetectedColumn[] = [
    ...stringOptions,
    ...suggestedRoots.flatMap((root) =>
      attributes.map((a) => ({
        column: `${root}.${a.property}`,
        datatype: "string" as const,
      })),
    ),
  ];

  const isValidIdentifier = (value: string) =>
    !!value &&
    (!!validColumn(identifierOptions, value) ||
      (!!splitFeatureUsageJsonField(value) &&
        jsonRootNames.includes(value.split(".")[0])));
  const mappedUserIdTypes = identifierTypes.filter((t) =>
    isValidIdentifier(userIdColumns[t] || ""),
  );

  const mappingForChecks: FeatureUsageQueryColumnMapping = {
    timestampColumn,
    featureKeyColumn,
    ...Object.fromEntries(
      OPTIONAL_ROLES.map(({ key }) => [
        MAPPING_KEYS[key],
        optionalColumns[key] || undefined,
      ]),
    ),
    userIdColumns: Object.fromEntries(
      mappedUserIdTypes.map((t) => [t, userIdColumns[t]]),
    ),
  };
  const columnsNeedingQuotes = findFeatureUsageColumnsNeedingQuotes(
    { columnMapping: mappingForChecks },
    getDataSourceSqlDialect(dataSource.type)?.unquotedIdentifierFold,
  );
  const jsonFieldError = getFeatureUsageJsonFieldError({
    columnMapping: mappingForChecks,
    columns,
  });

  const missingColumns = featureUsageQuery
    ? Object.entries({
        timestamp: timestampColumn,
        feature_key: featureKeyColumn,
        ...optionalColumns,
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
            queryType: "featureUsageQueryTest",
          }),
        },
      );
      if (res.error) throw new Error(res.error);
      const cols = res.columns || [];
      const error = getFeatureUsageColumnMappingError(cols);
      if (error) throw new Error(error);
      source.handleColumnsDetected(cols, sql);
    } catch (e) {
      setRefreshError(e.message);
    } finally {
      setRefreshingColumns(false);
    }
  }

  async function submit() {
    if (!detected) throw new Error("Test your SQL first");

    const timestamp = validColumn(timestampOptions, timestampColumn);
    const featureKey = validColumn(stringOptions, featureKeyColumn);
    if (!timestamp) throw new Error("Select a timestamp column");
    if (!featureKey) throw new Error("Select a feature key column");

    const optional = Object.fromEntries(
      OPTIONAL_ROLES.map(({ key }) => [
        key,
        validColumn(columns, optionalColumns[key] || ""),
      ]).filter(([, column]) => column),
    );

    // The generated SQL can't tell columns apart when they share one
    const mapped = [
      timestamp,
      featureKey,
      ...Object.values(optional),
      ...mappedUserIdTypes.map((t) => userIdColumns[t]),
    ];
    const duplicate = mapped.find((c, i) => mapped.indexOf(c) !== i);
    if (duplicate) {
      throw new Error(
        `Column "${duplicate}" is mapped more than once. Map each column to one role.`,
      );
    }
    if (columnsNeedingQuotes.length) {
      throw new Error(getColumnsNeedingQuotesMessage(columnsNeedingQuotes));
    }
    if (jsonFieldError) throw new Error(jsonFieldError);

    const remappedUserIds = getRemappedUserIdColumns(
      mappedUserIdTypes,
      userIdColumns,
    );

    // Only columns whose name isn't the standard one are stored
    const columnMapping: FeatureUsageQueryColumnMapping = Object.fromEntries(
      Object.entries({
        timestampColumn: timestamp !== "timestamp" ? timestamp : undefined,
        featureKeyColumn: featureKey !== "feature_key" ? featureKey : undefined,
        ...Object.fromEntries(
          OPTIONAL_ROLES.map(({ key }) => [
            MAPPING_KEYS[key],
            optional[key] && optional[key] !== key ? optional[key] : undefined,
          ]),
        ),
        userIdColumns: Object.keys(remappedUserIds).length
          ? remappedUserIds
          : undefined,
      }).filter(([, value]) => value !== undefined),
    );

    const saved: FeatureUsageQuery = {
      // Keep fields this modal doesn't edit, but not a stale mapping.
      ...omit(featureUsageQuery ?? {}, "columnMapping"),
      id: featureUsageQuery?.id ?? uniqId("fuq_"),
      query: querySql,
      userIdTypes: mappedUserIdTypes,
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
        featureUsageQuery
          ? "edit-feature-usage-query"
          : "new-feature-usage-query"
      }
      header={
        featureUsageQuery
          ? "Edit Feature Usage Query"
          : "Add Feature Usage Query"
      }
      step={step}
      setStep={setStep}
      submit={submit}
      close={onCancel}
      cta={featureUsageQuery ? "Save" : "Add"}
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
            placeholder={DEFAULT_QUERY}
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

            <Box>
              <Flex align="center" justify="between" mb="2">
                <Text as="div" weight="semibold">
                  Column mapping
                </Text>
                {featureUsageQuery ? (
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
              {missingColumns.length > 0 ? (
                <Callout status="warning" mb="2">
                  {`Your query no longer returns ${missingColumns
                    .map(([, column]) => `"${column}"`)
                    .join(", ")}. Choose a new column for each.`}
                </Callout>
              ) : null}
              <Table size="sm" variant="surface" layout="fixed" mb="2">
                <TableBody>
                  <ColumnMappingRow
                    label="Timestamp"
                    kind="timestamp"
                    tooltip="When the flag was evaluated"
                    value={timestampColumn}
                    options={timestampOptions}
                    setValue={setTimestampColumn}
                  />
                  <ColumnMappingRow
                    label="Feature key"
                    kind="feature"
                    value={featureKeyColumn}
                    options={stringOptions}
                    setValue={setFeatureKeyColumn}
                  />
                  {OPTIONAL_ROLES.slice(0, 2).map(({ key, label, tooltip }) => (
                    <ColumnMappingRow
                      key={key}
                      label={label}
                      kind="detail"
                      tooltip={tooltip}
                      value={optionalColumns[key] || ""}
                      options={columns}
                      setValue={(v) =>
                        setOptionalColumns((prev) => ({ ...prev, [key]: v }))
                      }
                      onRemove={() =>
                        setOptionalColumns((prev) => omit(prev, key))
                      }
                    />
                  ))}
                  {identifierTypes.map((idType) => (
                    <ColumnMappingRow
                      key={idType}
                      label={idType}
                      kind="identifier"
                      tooltip="Lets you filter evaluations by user and chart metrics for users who got the flag"
                      value={userIdColumns[idType] || ""}
                      options={identifierOptions}
                      setValue={(v) =>
                        setUserIdColumns((prev) => ({ ...prev, [idType]: v }))
                      }
                      onRemove={() =>
                        setUserIdColumns((prev) => omit(prev, idType))
                      }
                      customValue={
                        jsonRootNames.length
                          ? {
                              label: "Other JSON field...",
                              placeholder: `${suggestedRoots[0] ?? jsonRootNames[0]}.field_name`,
                            }
                          : undefined
                      }
                    />
                  ))}
                  {OPTIONAL_ROLES.slice(2).map(({ key, label, tooltip }) => (
                    <ColumnMappingRow
                      key={key}
                      label={label}
                      kind="detail"
                      tooltip={tooltip}
                      value={optionalColumns[key] || ""}
                      options={columns}
                      setValue={(v) =>
                        setOptionalColumns((prev) => ({ ...prev, [key]: v }))
                      }
                      onRemove={() =>
                        setOptionalColumns((prev) => omit(prev, key))
                      }
                    />
                  ))}
                  {mode === "table" && partition.available ? (
                    <ColumnMappingRow
                      kind="partition"
                      label="Date partition"
                      tooltip="Only reads recent partitions, to limit data scanned"
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
              {jsonFieldError ? (
                <Callout status="warning" size="sm" mb="2">
                  {jsonFieldError}
                </Callout>
              ) : null}
            </Box>
          </Flex>
        </Box>
      </Page>
    </PagedModal>
  );
};
