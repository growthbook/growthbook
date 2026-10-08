import React, { FC, useCallback, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  PastExperiment,
  PastExperimentsInterface,
} from "shared/types/past-experiments";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getValidDate, ago, date, datetime, daysBetween } from "shared/dates";
import {
  getExposureQueryIdentifierTypes,
  getPastExperimentQueryName,
  isProjectListValidForProject,
  parseIntWithDefault,
  parseOptionalInt,
} from "shared/util";
import Link from "@/ui/Link";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import {
  getExposureQueriesInScope,
  getExposureQuery,
  getImportIdentifierTypes,
} from "@/services/datasources";
import useOrgSettings from "@/hooks/useOrgSettings";
import { isCloud } from "@/services/env";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import Switch from "@/ui/Switch";
import LoadingOverlay from "@/components/LoadingOverlay";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import { generateVariationId } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Callout from "@/ui/Callout";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import TextField from "@/ui/TextField";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

const numberFormatter = new Intl.NumberFormat();

function QueryNames({ queries }: { queries: { id: string; name: string }[] }) {
  return (
    <>
      {queries.map((q, i) => (
        <React.Fragment key={q.id}>
          {i > 0 && (i === queries.length - 1 ? " and " : ", ")}
          <strong>{q.name}</strong>
        </React.Fragment>
      ))}
    </>
  );
}

const ImportExperimentList: FC<{
  onImport: (obj: Partial<ExperimentInterfaceStringDates>) => void;
  importId: string;
  showQueries?: boolean;
  changeDatasource?: (id: string) => void;
}> = ({ onImport, importId, showQueries = true, changeDatasource }) => {
  const { getDatasourceById, ready, datasources, project } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const { data, error, mutate } = useApi<{
    experiments: PastExperimentsInterface;
    // Null: imported into a Project the user can't read
    existing: Record<string, string | null>;
    lookbackDays: number;
  }>(`/experiments/import/${importId}`);
  const datasource = data?.experiments?.datasource
    ? getDatasourceById(data?.experiments?.datasource)
    : null;

  const { status } = getQueryStatus(
    data?.experiments?.queries || [],
    data?.experiments?.error,
  );
  const pastExpArr = useAddComputedFields(
    data?.experiments?.experiments,
    (item) => ({
      exposureQueryName: item.exposureQueryId
        ? getExposureQuery(datasource?.settings, item.exposureQueryId)?.name
        : "experiments",
      id: item.trackingKey,
    }),
    [datasource],
  );
  const { pastExperimentsMinLength, defaultDataSource } = useOrgSettings();

  const [minUsersFilter, setMinUsersFilter] = useLocalStorage(
    "pastImportNumUsersFilter",
    "100",
  );
  const [minLengthFilter, setMinLengthFilter] = useLocalStorage(
    "pastImportMinLengthFilter",
    `${pastExperimentsMinLength || 2}`,
  );
  const [alreadyImportedFilter, setAlreadyImportedFilter] = useState(true);
  const [dedupeFilter, setDedupeFilter] = useState(true);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "running" | "stopped"
  >("all");

  const [minVariationsFilter, setMinVariationsFilter] = useState("2");
  const [runError, setRunError] = useState<string | null>(null);

  const inScopeQueries = useMemo(
    () => (datasource ? getExposureQueriesInScope(datasource, project) : []),
    [datasource, project],
  );
  // Rows counted on an identifier their query no longer declares would import
  // with a different identifier than their counts, so they're left out.
  const inScopeIdentifierTypes = useMemo(
    () =>
      new Map(
        inScopeQueries.map((q) => [q.id, getExposureQueryIdentifierTypes(q)]),
      ),
    [inScopeQueries],
  );
  const { identifierTypes, initialIdentifierType } = useMemo(
    () => getImportIdentifierTypes(inScopeQueries),
    [inScopeQueries],
  );
  const isRowInScope = useCallback(
    (e: Pick<PastExperiment, "exposureQueryId" | "identifierType">) =>
      !!inScopeIdentifierTypes
        .get(e.exposureQueryId)
        ?.includes(e.identifierType ?? ""),
    [inScopeIdentifierTypes],
  );
  const identifiersWithRows = useMemo(
    () =>
      new Set(
        (data?.experiments?.experiments ?? [])
          .filter(isRowInScope)
          .map((e) => e.identifierType),
      ),
    [data?.experiments?.experiments, isRowInScope],
  );
  const [selectedIdentifierType, setSelectedIdentifierType] = useState<
    string | null
  >(null);
  // Don't open on an identifier with nothing found when another has results
  const startingIdentifierType =
    initialIdentifierType === null ||
    identifiersWithRows.has(initialIdentifierType)
      ? initialIdentifierType
      : (identifierTypes.find((t) => identifiersWithRows.has(t)) ??
        initialIdentifierType);
  const identifierType =
    selectedIdentifierType !== null &&
    identifierTypes.includes(selectedIdentifierType)
      ? selectedIdentifierType
      : startingIdentifierType;
  const isRowAvailable = useCallback(
    (e: Pick<PastExperiment, "exposureQueryId" | "identifierType">) =>
      isRowInScope(e) &&
      (identifierType === null || e.identifierType === identifierType),
    [isRowInScope, identifierType],
  );

  // Searching
  const filterResults = useCallback(
    (items: typeof pastExpArr) => {
      const rows = items.filter((e) => {
        if (!isRowAvailable(e)) return false;
        if (
          minUsersFilter &&
          e.users < parseIntWithDefault(minUsersFilter, 0)
        ) {
          return false;
        }
        if (alreadyImportedFilter) {
          const key = dedupeFilter
            ? e.trackingKey
            : e.trackingKey + "::" + e.exposureQueryId;
          if (data?.existing?.[key] !== undefined) {
            return false;
          }
        }
        const status =
          daysBetween(e.endDate, new Date()) < 2 ? "running" : "stopped";
        if (statusFilter !== "all" && statusFilter !== status) {
          return false;
        }

        if (
          minLengthFilter &&
          daysBetween(e.startDate, e.endDate) <
            parseIntWithDefault(minLengthFilter, 0)
        ) {
          return false;
        }

        const minVariations = parseOptionalInt(minVariationsFilter);
        if (minVariations !== undefined && e.numVariations < minVariations) {
          return false;
        }

        // Passed all the filters, include it in the table
        return true;
      });

      // Group by trackingKey instead of trackingKey/exposureQueryId
      if (dedupeFilter) {
        const deduped = new Map<string, (typeof rows)[0]>();
        rows.forEach((e) => {
          const key = e.trackingKey;
          if (!deduped.has(key)) {
            deduped.set(key, e);
          } else if ((deduped.get(key)?.users || 0) < e.users) {
            deduped.set(key, e);
          }
        });
        return Array.from(deduped.values());
      }

      return rows;
    },
    [
      alreadyImportedFilter,
      dedupeFilter,
      data?.existing,
      isRowAvailable,
      minLengthFilter,
      minUsersFilter,
      minVariationsFilter,
      statusFilter,
    ],
  );
  const {
    items,
    searchInputProps,
    clear: clearSearch,
    SortableTableColumnHeader,
  } = useSearch({
    items: pastExpArr,
    searchFields: ["trackingKey", "experimentName", "exposureQueryName"],
    defaultSortField: "startDate",
    defaultSortDir: -1,
    localStorageKey: "past-experiments",
    filterResults,
  });

  if (!importId) {
    return <LoadingOverlay />;
  }
  if (error) {
    return <Callout status="error">{error?.message}</Callout>;
  }
  if (!data || !ready) {
    return <LoadingOverlay />;
  }

  const supportedDatasources = datasources
    .filter((d) => d?.properties?.pastExperiments)
    .filter(
      (d) =>
        d.id === data?.experiments?.datasource ||
        isProjectListValidForProject(d.projects, project),
    );

  function clearFilters() {
    setAlreadyImportedFilter(false);
    setMinUsersFilter("0");
    setMinLengthFilter("0");
    setMinVariationsFilter("0");
    setStatusFilter("all");
    clearSearch();
  }

  const hasStarted = data.experiments.queries.length > 0;
  // Unlike getQueryStatus, an import refresh only fails when every query does.
  const importFailed =
    hasStarted &&
    status !== "running" &&
    (!!data.experiments.error ||
      data.experiments.queries.every((q) => q.status === "failed"));

  const identifierRows = pastExpArr.filter(isRowAvailable);

  // Queries the last refresh didn't run (no permission) or that failed. Records
  // not yet refreshed one query at a time have no runs and can't tell.
  const lastRunQueries = data.experiments.queries;
  const staleQueries =
    status === "running" ||
    !data.experiments.exposureQueryRuns?.length ||
    !lastRunQueries.length
      ? []
      : inScopeQueries.filter(
          (q) =>
            !lastRunQueries.some(
              (r) =>
                r.name === getPastExperimentQueryName(q.id) &&
                r.status === "succeeded",
            ),
        );
  const staleLastRunAt =
    staleQueries.length === 1
      ? data.experiments.exposureQueryRuns?.find(
          (r) => r.exposureQueryId === staleQueries[0].id,
        )?.lastRunAt
      : undefined;
  // How far back every query in view has data
  const lookbackStart = inScopeQueries.reduce<Date | null>((latest, q) => {
    const start = data.experiments.exposureQueryRuns?.find(
      (r) => r.exposureQueryId === q.id,
    )?.start;
    if (!start) return latest;
    const d = getValidDate(start);
    return !latest || d > latest ? d : latest;
  }, null);

  const staleQueriesUserCantRun = datasource
    ? staleQueries.filter(
        (q) => !permissionsUtil.canRunPastExperimentQuery(q, datasource),
      )
    : [];

  const totalRows = dedupeFilter
    ? new Set(identifierRows.map((e) => e.trackingKey)).size
    : identifierRows.length;

  return (
    <>
      <Flex align="end" gap="3" wrap="wrap" mb="4">
        <Box>
          {changeDatasource && supportedDatasources.length > 1 ? (
            <Select
              label="Data Source"
              labelSize="sm"
              size="sm"
              value={data.experiments.datasource}
              setValue={changeDatasource}
            >
              {supportedDatasources.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                  {d.description ? ` — ${d.description}` : ""}
                  {d.id === defaultDataSource ? " (default)" : ""}
                </SelectItem>
              ))}
            </Select>
          ) : (
            <>
              <Text as="div" weight="semibold">
                {datasource?.name}
              </Text>
              <Text as="div" size="sm" color="text-mid" truncate>
                {datasource?.description}
              </Text>
            </>
          )}
        </Box>
        <Flex align="center" gap="3" ml="auto">
          {hasStarted && (
            <Text
              size="sm"
              color="text-low"
              title={datetime(data.experiments.runStarted ?? "")}
            >
              last updated {ago(data.experiments.runStarted ?? "")}
            </Text>
          )}
          {datasource &&
            permissionsUtil.canRunPastExperimentQueries(datasource) && (
              <RunQueriesButton
                cta={data.experiments.latestData ? "Get new data" : "Run query"}
                cancelEndpoint={`/experiments/import/${data.experiments.id}/cancel`}
                mutate={mutate}
                model={data.experiments}
                icon="refresh"
                setError={setRunError}
                onSubmit={async () => {
                  await apiCall<{ id: string }>("/experiments/import", {
                    method: "POST",
                    body: JSON.stringify({
                      datasource: data.experiments.datasource,
                      force: true,
                    }),
                  });
                  await mutate();
                }}
              />
            )}
        </Flex>
      </Flex>
      {(runError || importFailed) && (
        <Callout status="error" my="3">
          {runError && <p>Could not start a new import: {runError}</p>}
          {importFailed && (
            <>
              <p>Error importing experiments.</p>
              {datasource?.id && (
                <>
                  {!!datasource?.dateUpdated &&
                  datasource?.dateUpdated > data?.experiments?.dateUpdated ? (
                    <p>
                      Your Data Source&apos;s{" "}
                      <em>Experiment Assignment Queries</em> may have been
                      misconfigured. The Data Source has been modified since the
                      last data refresh, so use the &apos;Get new data&apos;
                      button above to check if the issue has been resolved.
                      Otherwise,{" "}
                      <Link href={`/datasources/${datasource.id}?openAll=1`}>
                        edit the Data Source
                      </Link>
                      .
                    </p>
                  ) : (
                    <p>
                      Your Data Source&apos;s{" "}
                      <em>Experiment Assignment Queries</em> may be
                      misconfigured.{" "}
                      <Link href={`/datasources/${datasource.id}?openAll=1`}>
                        Edit the Data Source
                      </Link>
                      .
                    </p>
                  )}
                </>
              )}

              <span>
                <ViewAsyncQueriesButton
                  queries={data.experiments.queries?.map((q) => q.query) ?? []}
                  error={data.experiments.error}
                  ctaComponent={(onClick) => (
                    <Link onClick={onClick}>View queries</Link>
                  )}
                />{" "}
                for more information.
              </span>
            </>
          )}
        </Callout>
      )}
      {staleQueries.length > 0 && (
        <Callout status="warning" my="3">
          <QueryNames queries={staleQueries} />{" "}
          {staleQueries.length === 1 ? (
            <>
              wasn&apos;t included in the last refresh, so its results{" "}
              {staleLastRunAt
                ? `are from ${date(staleLastRunAt)}`
                : "may be out of date"}
              .
            </>
          ) : (
            <>
              weren&apos;t included in the last refresh, so their results may be
              out of date.
            </>
          )}
          {staleQueriesUserCantRun.length > 0 && (
            <>
              {" "}
              Refreshing <QueryNames queries={staleQueriesUserCantRun} />{" "}
              requires permission to run queries in{" "}
              {staleQueriesUserCantRun.length === 1 ? "its" : "their"} Projects.
            </>
          )}
        </Callout>
      )}
      {identifiersWithRows.size === 0 && (
        <Box>
          {status === "running" ? (
            <LoadingSpinner />
          ) : !hasStarted ? (
            <>
              <p>
                Click the button above to query the past{" "}
                <strong>{data.lookbackDays} days</strong> of data across all of
                your Experiment Assignment queries.{" "}
                {!isCloud() && (
                  <>
                    You can adjust this lookback window with the{" "}
                    <code>IMPORT_LIMIT_DAYS</code> environment variable.
                  </>
                )}
              </p>
              <p>
                After this initial import, you will be able to perform smaller
                incremental queries to keep this list up-to-date.
              </p>
            </>
          ) : (
            <>
              <Heading as="h4" size="sm" mb="2">
                No Experiments Found
              </Heading>
              <p>
                No past experiments were returned from this Data Source. If you
                are expecting past experiments, check the following:
              </p>
              <ul>
                <li>
                  Too old: this query only shows experiments from the last 12
                  months by default (you can adjust the import date limit from
                  the settings)
                </li>
                <li>
                  Not enough traffic: experiments are not shown if they had
                  fewer than 5 units per variation
                </li>
                <li>
                  Incorrect query: the experiment exposure query runs but is not
                  pulling the right data
                </li>
              </ul>
            </>
          )}
        </Box>
      )}
      {identifiersWithRows.size > 0 && (
        <Box>
          <Heading as="h4" size="sm" mb="2">
            Experiments
          </Heading>
          <p>
            These are all of the experiments we found in your Data Source{" "}
            {data.experiments.config && (
              <>
                from{" "}
                <strong>
                  {date(lookbackStart ?? data.experiments.config.start)}
                </strong>{" "}
                to <strong>{date(data.experiments.config.end)}</strong>{" "}
                {!isCloud() && (
                  <Tooltip
                    body={
                      <>
                        You can change the lookback window with the{" "}
                        <code>IMPORT_LIMIT_DAYS</code> environment variable.
                      </>
                    }
                  />
                )}
              </>
            )}
            .
          </p>
          <Flex align="end" gap="3" wrap="wrap" mb="3">
            {identifierType !== null && identifierTypes.length > 1 && (
              <Select
                label="Identifier"
                labelSize="sm"
                size="sm"
                value={identifierType}
                setValue={setSelectedIdentifierType}
              >
                {identifierTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </Select>
            )}
            <TextField
              label="Search"
              labelSize="sm"
              size="sm"
              placeholder="Search..."
              type="search"
              {...searchInputProps}
            />
            <TextField
              label="Units"
              labelSize="sm"
              size="sm"
              type="number"
              min={0}
              step={1}
              prepend={<>&ge;</>}
              style={{ width: 110 }}
              value={minUsersFilter}
              onChange={(e) => {
                setMinUsersFilter(e.target.value || "");
              }}
            />
            <TextField
              label="Test duration"
              labelSize="sm"
              size="sm"
              type="number"
              min={0}
              step={1}
              prepend={<>&ge;</>}
              append="days"
              style={{ width: 120 }}
              value={minLengthFilter}
              onChange={(e) => {
                setMinLengthFilter(e.target.value || "");
              }}
            />
            <TextField
              label="Variations"
              labelSize="sm"
              size="sm"
              type="number"
              min={1}
              step={1}
              prepend={<>&ge;</>}
              style={{ width: 80 }}
              value={minVariationsFilter}
              onChange={(e) => {
                setMinVariationsFilter(e.target.value);
              }}
            />
            <Select
              label="Status"
              labelSize="sm"
              size="sm"
              value={statusFilter}
              setValue={(value) =>
                setStatusFilter(value as "all" | "running" | "stopped")
              }
            >
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="stopped">Stopped</SelectItem>
            </Select>
            <Box pb="1">
              <Switch
                id="hide-imported"
                label="Hide imported"
                value={alreadyImportedFilter}
                onChange={setAlreadyImportedFilter}
              />
            </Box>
            <Box pb="1">
              <Switch
                id="dedupe-experiments"
                label={
                  <>
                    <span>Group by experiment ID</span>{" "}
                    <Tooltip body="How to handle experiments that appear in multiple Assignment Queries. If toggled ON, collapse them into a single row. If OFF, show each one in a separate row." />
                  </>
                }
                value={dedupeFilter}
                onChange={setDedupeFilter}
              />
            </Box>
          </Flex>
          <Text as="div" size="sm" mb="2">
            Showing <strong>{items.length}</strong> of{" "}
            <strong>{totalRows}</strong> experiments.{" "}
            {items.length < totalRows && (
              <Link onClick={clearFilters}>Clear all filters</Link>
            )}
          </Text>
          <Table variant="surface">
            <TableHeader>
              <TableRow>
                <SortableTableColumnHeader field="exposureQueryName">
                  Assignment query
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="experimentName">
                  Experiment ID
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="startDate">
                  Date started
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="endDate">
                  Date ended
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="numVariations">
                  Variations
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="users">
                  Approx units{" "}
                  <Tooltip body="This count is approximate and does not de-duplicate units across days; therefore it is likely inflated. Once imported, the unit counts will be accurate." />
                </SortableTableColumnHeader>
                <TableColumnHeader>Traffic split</TableColumnHeader>
                <TableColumnHeader />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((e) => {
                const key = dedupeFilter
                  ? e.trackingKey
                  : e.trackingKey + "::" + e.exposureQueryId;
                const existingId = data?.existing?.[key];

                return (
                  <TableRow key={key}>
                    <TableCell style={{ wordBreak: "break-word" }}>
                      {e.exposureQueryName}
                    </TableCell>
                    <TableCell style={{ wordBreak: "break-word" }}>
                      {e.experimentName || e.trackingKey}
                    </TableCell>
                    <TableCell>
                      <Tooltip
                        body={
                          e.startOfRange
                            ? "We only have partial data for this experiment since it was already running at the start of our query"
                            : ""
                        }
                      >
                        {date(e.startDate)}
                        {e.startOfRange ? "*" : ""}
                      </Tooltip>
                    </TableCell>
                    <TableCell>{date(e.endDate)}</TableCell>
                    <TableCell>{e.numVariations}</TableCell>
                    <TableCell>{numberFormatter.format(e.users)}</TableCell>
                    <TableCell style={{ maxWidth: 180 }}>
                      {e.weights.map((w) => Math.round(w * 100)).join(" / ")}
                    </TableCell>
                    <TableCell>
                      {existingId ? (
                        <Link href={`/experiment/${existingId}`}>imported</Link>
                      ) : existingId === null ? (
                        <Tooltip body="Imported into a Project you don't have access to">
                          <Text color="text-mid">imported</Text>
                        </Tooltip>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => {
                            const variations = e.variationKeys.map(
                              (vKey, i) => {
                                let vName = e.variationNames?.[i] || vKey;
                                // If the name is an integer, rename 0 to "Control" and anything else to "Variation {name}"
                                if (vName.match(/^[0-9]{1,2}$/)) {
                                  vName =
                                    vName === "0"
                                      ? "Control"
                                      : `Variation ${vName}`;
                                }
                                return {
                                  id: generateVariationId(),
                                  name: vName,
                                  key: vKey,
                                  screenshots: [],
                                  description: "",
                                };
                              },
                            );
                            const importObj: Partial<ExperimentInterfaceStringDates> =
                              {
                                name: e.experimentName || e.trackingKey,
                                trackingKey: e.trackingKey,
                                datasource: data?.experiments?.datasource,
                                exposureQueryId: e.exposureQueryId || "",
                                exposureQueryIdentifierType: e.identifierType,
                                variations,
                                phases: [
                                  {
                                    coverage: 1,
                                    name: "Main",
                                    reason: "",
                                    variationWeights: e.weights,
                                    variations: variations.map((v) => ({
                                      id: v.id,
                                      status: "active" as const,
                                    })),
                                    dateStarted:
                                      getValidDate(e.startDate)
                                        .toISOString()
                                        .substr(0, 10) + "T00:00:00Z",
                                    dateEnded:
                                      getValidDate(e.endDate)
                                        .toISOString()
                                        .substr(0, 10) + "T23:59:59Z",
                                    condition: "",
                                    namespace: {
                                      enabled: false,
                                      name: "",
                                      range: [0, 1],
                                    },
                                  },
                                ],
                                // Default to stopped if the last data was more than 3 days ago
                                status:
                                  getValidDate(e.endDate).getTime() <
                                  Date.now() - 72 * 60 * 60 * 1000
                                    ? "stopped"
                                    : "running",
                              };
                            onImport(importObj);
                          }}
                        >
                          Import
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {items.length <= 0 && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <Callout status="info">
                      No experiments match your current filters.{" "}
                      <Link onClick={clearFilters}>Clear all filters</Link>
                    </Callout>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      )}

      {datasource &&
        permissionsUtil.canRunPastExperimentQueries(datasource) &&
        data.experiments.latestData &&
        status !== "running" && (
          <Flex justify="end" mt="3">
            <Tooltip
              body={
                <>
                  This will wipe the above table and query the past{" "}
                  <strong>{data.lookbackDays} days</strong> of data from
                  scratch. Use the &apos;Get new data&apos; button above to
                  perform a more efficient incremental query.
                </>
              }
            >
              <Link
                onClick={async () => {
                  await apiCall<{ id: string }>("/experiments/import", {
                    method: "POST",
                    body: JSON.stringify({
                      datasource: data.experiments.datasource,
                      force: true,
                      refresh: true,
                    }),
                  });
                  await mutate();
                }}
              >
                Full refresh
              </Link>
            </Tooltip>
          </Flex>
        )}

      {showQueries && hasStarted && (
        <Box>
          <ViewAsyncQueriesButton
            queries={
              data.experiments.queries?.length > 0
                ? data.experiments.queries.map((q) => q.query)
                : []
            }
            error={data.experiments.error}
            inline={true}
          />
        </Box>
      )}
    </>
  );
};

export default ImportExperimentList;
