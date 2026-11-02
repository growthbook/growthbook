import React, { FC, useCallback, useEffect, useMemo, useState } from "react";
import {
  PastExperiment,
  PastExperimentsInterface,
} from "shared/types/past-experiments";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Box, Flex } from "@radix-ui/themes";
import {
  abbreviateAgo,
  getValidDate,
  date,
  datetime,
  daysBetween,
} from "shared/dates";
import {
  getExposureQueryIdentifierTypes,
  getPastExperimentQueryName,
  isProjectListValidForProject,
} from "shared/util";
import Link from "@/ui/Link";
import {
  SyntaxFilter,
  transformQuery,
  useAddComputedFields,
  useSearch,
} from "@/services/search";
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
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import LoadingOverlay from "@/components/LoadingOverlay";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import {
  FilterDropdown,
  FilterHeading,
  FilterItem,
  filterToString,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { InfoTip } from "@/components/Experiment/TabbedPage/SetupFieldRow";
import { generateVariationId } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import UITooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

const numberFormatter = new Intl.NumberFormat();

const PAGE_SIZE = 20;
const DEFAULT_MIN_UNITS = 100;
const UNIT_MINIMUMS = [DEFAULT_MIN_UNITS, 1000, 10000];
const DAY_MINIMUMS = [1, 7, 14, 30];

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

  const [dedupeFilter, setDedupeFilter] = useState(true);
  const [runError, setRunError] = useState<string | null>(null);
  const [queriesOpen, setQueriesOpen] = useState(false);

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

  const importedKey = useCallback(
    (e: Pick<PastExperiment, "trackingKey" | "exposureQueryId">) =>
      dedupeFilter ? e.trackingKey : e.trackingKey + "::" + e.exposureQueryId,
    [dedupeFilter],
  );

  // One identifier at a time, and only real experiments: a single variation
  // has nothing to compare.
  const filterResults = useCallback(
    (items: typeof pastExpArr) => {
      const rows = items.filter(
        (e) => isRowAvailable(e) && e.numVariations >= 2,
      );
      if (!dedupeFilter) return rows;
      // Group by trackingKey instead of trackingKey/exposureQueryId
      const deduped = new Map<string, (typeof rows)[0]>();
      rows.forEach((e) => {
        if ((deduped.get(e.trackingKey)?.users ?? -1) < e.users) {
          deduped.set(e.trackingKey, e);
        }
      });
      return Array.from(deduped.values());
    },
    [dedupeFilter, isRowAvailable],
  );
  const searchTermFilters = useMemo(
    () => ({
      query: (e: (typeof pastExpArr)[number]) => e.exposureQueryName,
      status: (e: (typeof pastExpArr)[number]) =>
        daysBetween(e.endDate, new Date()) < 2 ? "running" : "stopped",
      units: (e: (typeof pastExpArr)[number]) => e.users,
      days: (e: (typeof pastExpArr)[number]) =>
        daysBetween(e.startDate, e.endDate),
      imported: (e: (typeof pastExpArr)[number]) =>
        data?.existing?.[importedKey(e)] !== undefined ? "yes" : "no",
    }),
    [data?.existing, importedKey],
  );
  const {
    items,
    unpaginatedItems,
    searchInputProps,
    syntaxFilters,
    setSearchValue,
    SortableTableColumnHeader,
    pagination,
  } = useSearch({
    items: pastExpArr,
    searchFields: ["trackingKey", "experimentName", "exposureQueryName"],
    defaultSortField: "startDate",
    defaultSortDir: -1,
    localStorageKey: "past-experiments",
    filterResults,
    searchTermFilters,
    searchTermFilterDeps: [data?.existing, dedupeFilter],
    disableUrlSearchTerm: true,
    pageSize: PAGE_SIZE,
  });
  // Starts on the usual cuts, in the search box where they can be changed.
  useEffect(() => {
    setSearchValue(
      `imported:no units:>${DEFAULT_MIN_UNITS} days:>${Math.max(
        0,
        (pastExperimentsMinLength || 2) - 1,
      )}`,
    );
  }, [setSearchValue, pastExperimentsMinLength]);
  const { dropdownFilterOpen, setDropdownFilterOpen, updateQuery } =
    useSearchFiltersBase({ searchInputProps, syntaxFilters, setSearchValue });
  // A minimum, or the imported choice, replaces the one before it rather than
  // adding a second value.
  // A minimum typed into the search joins the presets, so the menu shows it.
  const minimums = (field: string, presets: number[]) => {
    const typed = syntaxFilters
      .filter((f) => f.field === field && f.operator === ">")
      .flatMap((f) => f.values.map(Number))
      .filter((n) => Number.isFinite(n) && !presets.includes(n));
    return [...presets, ...typed].sort((a, b) => a - b);
  };
  // What a facet's trigger says: its selection, or its name when none.
  const facetLabel = (
    field: string,
    name: string,
    format: (values: string[]) => string,
  ) => {
    const f = syntaxFilters.find((s) => s.field === field);
    return f
      ? `${f.negated ? "Not " : ""}${f.operator}${format(f.values)}`
      : name;
  };
  const replaceFilter = (filter: SyntaxFilter) => {
    const kept = syntaxFilters.filter((f) => f.field !== filter.field);
    const same = syntaxFilters.some(
      (f) =>
        f.field === filter.field &&
        f.operator === filter.operator &&
        f.values.join() === filter.values.join(),
    );
    const { searchTerm } = transformQuery(
      searchInputProps.value,
      Object.keys(searchTermFilters),
    );
    setSearchValue(
      [searchTerm, ...[...kept, ...(same ? [] : [filter])].map(filterToString)]
        .filter(Boolean)
        .join(" "),
    );
  };

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
  const failedQueries = staleQueries.filter((q) =>
    lastRunQueries.some(
      (r) =>
        r.name === getPastExperimentQueryName(q.id) && r.status === "failed",
    ),
  );
  const skippedQueries = staleQueries.filter((q) => !failedQueries.includes(q));
  const describeStaleResults = (queries: { id: string }[]) => {
    if (queries.length > 1) return "their results may be out of date";
    const lastRunAt = data.experiments.exposureQueryRuns?.find(
      (r) => r.exposureQueryId === queries[0].id,
    )?.lastRunAt;
    return lastRunAt
      ? `its results are from ${date(lastRunAt)}`
      : "its results may be out of date";
  };
  // The earliest data any row on screen can come from
  const lookbackStart = inScopeQueries
    .filter(
      (q) =>
        identifierType === null ||
        inScopeIdentifierTypes.get(q.id)?.includes(identifierType),
    )
    .reduce<Date | null>((earliest, q) => {
      const start = data.experiments.exposureQueryRuns?.find(
        (r) => r.exposureQueryId === q.id,
      )?.start;
      if (!start) return earliest;
      const d = getValidDate(start);
      return !earliest || d < earliest ? d : earliest;
    }, null);

  const staleQueriesUserCantRun = datasource
    ? skippedQueries.filter(
        (q) => !permissionsUtil.canRunPastExperimentQuery(q, datasource),
      )
    : [];

  const totalRows = dedupeFilter
    ? new Set(identifierRows.map((e) => e.trackingKey)).size
    : identifierRows.length;

  const canRun =
    !!datasource && permissionsUtil.canRunPastExperimentQueries(datasource);
  const queryStrings = data.experiments.queries.map((q) => q.query);
  const runStarted = data.experiments.runStarted ?? "";

  const importRow = (e: (typeof items)[number]) => {
    const variations = e.variationKeys.map((vKey, i) => {
      let vName = e.variationNames?.[i] || vKey;
      // If the name is an integer, rename 0 to "Control" and anything else to "Variation {name}"
      if (vName.match(/^[0-9]{1,2}$/)) {
        vName = vName === "0" ? "Control" : `Variation ${vName}`;
      }
      return {
        id: generateVariationId(),
        name: vName,
        key: vKey,
        screenshots: [],
        description: "",
      };
    });
    onImport({
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
            getValidDate(e.startDate).toISOString().substr(0, 10) +
            "T00:00:00Z",
          dateEnded:
            getValidDate(e.endDate).toISOString().substr(0, 10) + "T23:59:59Z",
          condition: "",
          namespace: {
            enabled: false,
            name: "",
            range: [0, 1],
          },
        },
      ],
      implementationType: "none",
      // Default to stopped if the last data was more than 3 days ago
      status:
        getValidDate(e.endDate).getTime() < Date.now() - 72 * 60 * 60 * 1000
          ? "stopped"
          : "running",
    });
  };

  return (
    <>
      {queriesOpen ? (
        <AsyncQueriesModal
          queries={queryStrings}
          savedQueries={[]}
          error={data.experiments.error}
          close={() => setQueriesOpen(false)}
        />
      ) : null}
      <Flex align="end" justify="between" gap="4" wrap="wrap" mb="7">
        <Flex align="end" gap="3" minWidth="0">
          <Box flexBasis="360px" flexShrink="1" minWidth="0">
            {changeDatasource && supportedDatasources.length > 1 ? (
              <SelectField
                label="Data Source"
                containerClassName="mb-0"
                value={data.experiments.datasource}
                options={supportedDatasources.map((d) => ({
                  value: d.id,
                  label: `${d.name}${d.description ? ` — ${d.description}` : ""}${
                    d.id === defaultDataSource ? " (default)" : ""
                  }`,
                }))}
                className="portal-overflow-ellipsis"
                onChange={changeDatasource}
              />
            ) : (
              <Flex direction="column">
                <Text weight="semibold" color="text-high">
                  {datasource?.name}
                </Text>
                {datasource?.description ? (
                  <Text size="sm" color="text-mid" truncate>
                    {datasource.description}
                  </Text>
                ) : null}
              </Flex>
            )}
          </Box>
          {/* One identifier at a time: its counts are what an import keeps. */}
          {identifierType !== null && identifierTypes.length > 1 ? (
            <SelectField
              label="Identifier"
              containerClassName="mb-0"
              value={identifierType}
              onChange={setSelectedIdentifierType}
              options={identifierTypes.map((t) => ({ label: t, value: t }))}
            />
          ) : null}
        </Flex>
        <Flex align="center" gap="4">
          {hasStarted ? (
            <UITooltip content={`Last update: ${datetime(runStarted)}`}>
              <Text color="text-mid">Updated {abbreviateAgo(runStarted)}</Text>
            </UITooltip>
          ) : null}
          {canRun ? (
            <RunQueriesButton
              cta={data.experiments.latestData ? "Update" : "Run query"}
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
          ) : null}
          {showQueries && hasStarted ? (
            <DropdownMenu
              trigger={<MoreMenuTrigger label="Import actions" />}
              menuPlacement="end"
              variant="soft"
            >
              <DropdownMenuItem onClick={() => setQueriesOpen(true)}>
                View queries
                <Badge
                  variant="soft"
                  radius="full"
                  label={String(queryStrings.length)}
                  ml="2"
                  color={data.experiments.error ? "red" : undefined}
                />
              </DropdownMenuItem>
              {canRun && data.experiments.latestData && status !== "running" ? (
                <DropdownMenuItem
                  confirmation={{
                    confirmationTitle: "Full refresh",
                    cta: "Full refresh",
                    getConfirmationContent: async () =>
                      `This clears the list and queries the past ${data.lookbackDays} days of data from scratch. Update runs a faster incremental query instead.`,
                    submit: async () => {
                      await apiCall<{ id: string }>("/experiments/import", {
                        method: "POST",
                        body: JSON.stringify({
                          datasource: data.experiments.datasource,
                          force: true,
                          refresh: true,
                        }),
                      });
                      await mutate();
                    },
                  }}
                >
                  Full refresh
                </DropdownMenuItem>
              ) : null}
            </DropdownMenu>
          ) : null}
        </Flex>
      </Flex>
      {(runError || importFailed) && (
        <Callout status="error" mb="3">
          {runError && <p>Could not start a new import: {runError}</p>}
          {importFailed && (
            <>
              <p>Error importing experiments.</p>
              {datasource?.id && (
                <>
                  {!!datasource?.dateUpdated &&
                  datasource?.dateUpdated > data?.experiments?.dateUpdated ? (
                    <p>
                      Your datasource&apos;s{" "}
                      <em>Experiment Assignment Queries</em> may have been
                      misconfigured. The datasource has been modified since the
                      last data refresh, so use the Update button above to check
                      if the issue has been resolved. Otherwise,{" "}
                      <Link href={`/datasources/${datasource.id}?openAll=1`}>
                        edit the datasource
                      </Link>
                      .
                    </p>
                  ) : (
                    <p>
                      Your datasource&apos;s{" "}
                      <em>Experiment Assignment Queries</em> may be
                      misconfigured.{" "}
                      <Link href={`/datasources/${datasource.id}?openAll=1`}>
                        Edit the datasource
                      </Link>
                      .
                    </p>
                  )}
                </>
              )}
              <span>
                <Link onClick={() => setQueriesOpen(true)}>View queries</Link>{" "}
                for more information.
              </span>
            </>
          )}
        </Callout>
      )}
      {staleQueries.length > 0 && (
        <Callout status="warning" mb="3">
          {failedQueries.length > 0 && (
            <>
              <QueryNames queries={failedQueries} /> failed on the last refresh,
              so {describeStaleResults(failedQueries)}.{" "}
            </>
          )}
          {skippedQueries.length > 0 && (
            <>
              <QueryNames queries={skippedQueries} />{" "}
              {skippedQueries.length === 1 ? "wasn't" : "weren't"} included in
              the last refresh, so {describeStaleResults(skippedQueries)}.{" "}
            </>
          )}
          {staleQueriesUserCantRun.length > 0 && (
            <>
              Refreshing <QueryNames queries={staleQueriesUserCantRun} />{" "}
              requires permission to run queries in{" "}
              {staleQueriesUserCantRun.length === 1 ? "its" : "their"} Projects.
            </>
          )}
        </Callout>
      )}
      {identifiersWithRows.size === 0 && (
        <div>
          {status === "running" ? (
            <LoadingSpinner />
          ) : !hasStarted ? (
            <>
              <p>
                Run the query to look through the past{" "}
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
              <h4>No experiments found</h4>
              <p>
                No past experiments were returned from this data source. If you
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
        </div>
      )}
      {identifiersWithRows.size > 0 && (
        <>
          {/* Short on room, the filters wrap above the search. */}
          <Flex
            align="center"
            justify="between"
            gap="4"
            wrap="wrap-reverse"
            mb="3"
          >
            <Box flexBasis="240px" flexGrow="1">
              <Field
                placeholder="Search..."
                type="search"
                containerClassName="mb-0"
                {...searchInputProps}
              />
            </Box>
            <Flex gap="4" align="center" wrap="wrap" ml="auto">
              {inScopeQueries.length > 1 ? (
                <FilterDropdown
                  filter="query"
                  label={facetLabel("query", "Assignment query", (v) =>
                    v.length > 1 ? `${v.length} assignment queries` : v[0],
                  )}
                  size="2"
                  heading="Assignment query"
                  items={inScopeQueries.map((q) => ({
                    id: q.id,
                    name: q.name,
                    searchValue: q.name,
                  }))}
                  syntaxFilters={syntaxFilters}
                  open={dropdownFilterOpen}
                  setOpen={setDropdownFilterOpen}
                  updateQuery={updateQuery}
                  menuPlacement="end"
                />
              ) : null}
              <FilterDropdown
                filter="status"
                label={facetLabel("status", "Status", (v) =>
                  v.map((x) => x[0].toUpperCase() + x.slice(1)).join(", "),
                )}
                size="2"
                heading="Status"
                items={[
                  { id: "running", name: "Running", searchValue: "running" },
                  { id: "stopped", name: "Stopped", searchValue: "stopped" },
                ]}
                syntaxFilters={syntaxFilters}
                open={dropdownFilterOpen}
                setOpen={setDropdownFilterOpen}
                updateQuery={updateQuery}
                menuPlacement="end"
              />
              <FilterDropdown
                filter="units"
                label={facetLabel(
                  "units",
                  "Units",
                  (v) =>
                    `${v.map((x) => numberFormatter.format(Number(x))).join(", ")} units`,
                )}
                size="2"
                heading="Units"
                operator=">"
                items={minimums("units", UNIT_MINIMUMS).map((n) => ({
                  id: String(n),
                  name: `More than ${numberFormatter.format(n)}`,
                  searchValue: String(n),
                  operator: ">",
                }))}
                syntaxFilters={syntaxFilters}
                open={dropdownFilterOpen}
                setOpen={setDropdownFilterOpen}
                updateQuery={replaceFilter}
                menuPlacement="end"
              />
              <FilterDropdown
                filter="days"
                label={facetLabel(
                  "days",
                  "Duration",
                  (v) => `${v.join(", ")} days`,
                )}
                size="2"
                heading="Duration"
                operator=">"
                items={minimums("days", DAY_MINIMUMS).map((n) => ({
                  id: String(n),
                  name: `More than ${n} day${n === 1 ? "" : "s"}`,
                  searchValue: String(n),
                  operator: ">",
                }))}
                syntaxFilters={syntaxFilters}
                open={dropdownFilterOpen}
                setOpen={setDropdownFilterOpen}
                updateQuery={replaceFilter}
                menuPlacement="end"
              />
              <FilterDropdown
                filter="imported"
                label={facetLabel("imported", "Imported", (v) =>
                  v
                    .map((x) => (x === "yes" ? "Imported" : "Not imported"))
                    .join(", "),
                )}
                size="2"
                heading="Imported"
                items={[
                  { id: "no", name: "Not imported", searchValue: "no" },
                  { id: "yes", name: "Imported", searchValue: "yes" },
                ]}
                syntaxFilters={syntaxFilters}
                open={dropdownFilterOpen}
                setOpen={setDropdownFilterOpen}
                updateQuery={replaceFilter}
                menuPlacement="end"
              />
              {/* For experiments more than one Assignment Query found. */}
              <DropdownMenu
                trigger={FilterHeading({
                  heading: dedupeFilter
                    ? "Per experiment ID"
                    : "Per assignment query",
                  open: dropdownFilterOpen === "rows",
                  size: "2",
                })}
                open={dropdownFilterOpen === "rows"}
                onOpenChange={(o) => setDropdownFilterOpen(o ? "rows" : "")}
                menuPlacement="end"
                variant="soft"
              >
                <DropdownMenuItem onClick={() => setDedupeFilter(true)}>
                  <FilterItem
                    item="One per experiment ID"
                    exists={dedupeFilter}
                  />
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDedupeFilter(false)}>
                  <FilterItem
                    item="One per assignment query"
                    exists={!dedupeFilter}
                  />
                </DropdownMenuItem>
              </DropdownMenu>
            </Flex>
          </Flex>
          <Table variant="list" roundedCorners>
            <TableHeader>
              <TableRow>
                <SortableTableColumnHeader field="exposureQueryName">
                  Assignment query
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="experimentName">
                  Experiment ID
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="startDate">
                  Started
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="endDate">
                  Ended
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="numVariations">
                  Variations
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="users">
                  <Flex align="center" gap="1">
                    Approx. units
                    <InfoTip content="Approximate, and likely high: units aren't de-duplicated across days. Once imported, the counts are exact." />
                  </Flex>
                </SortableTableColumnHeader>
                <TableColumnHeader>Traffic split</TableColumnHeader>
                <TableColumnHeader style={{ width: 100 }} />
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
                      <UITooltip
                        content="Partial data: it was already running when this query's window starts."
                        enabled={!!e.startOfRange}
                      >
                        <span>
                          {date(e.startDate)}
                          {e.startOfRange ? "*" : ""}
                        </span>
                      </UITooltip>
                    </TableCell>
                    <TableCell>{date(e.endDate)}</TableCell>
                    <TableCell>{e.numVariations}</TableCell>
                    <TableCell>{numberFormatter.format(e.users)}</TableCell>
                    <TableCell>
                      {e.weights.map((w) => Math.round(w * 100)).join(" / ")}
                    </TableCell>
                    <TableCell style={{ textAlign: "right" }}>
                      {existingId ? (
                        <Link href={`/experiment/${existingId}`}>Imported</Link>
                      ) : existingId === null ? (
                        <UITooltip content="Imported into a Project you don't have access to">
                          <span tabIndex={0}>
                            <Text color="text-mid">Imported</Text>
                          </span>
                        </UITooltip>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => importRow(e)}
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
                    <Text color="text-mid">
                      {identifierType !== null &&
                      !identifiersWithRows.has(identifierType) ? (
                        <>No experiments found for {identifierType}.</>
                      ) : (
                        <>No experiments match your search.</>
                      )}
                    </Text>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Flex align="center" justify="between" gap="4" wrap="wrap" mt="3">
            <Text size="sm" color="text-mid">
              {unpaginatedItems.length} of {totalRows} experiments
              {data.experiments.config ? (
                <>
                  {" "}
                  found from{" "}
                  {date(lookbackStart ?? data.experiments.config.start)} to{" "}
                  {date(data.experiments.config.end)}
                  {!isCloud() ? (
                    <>
                      {" "}
                      <InfoTip
                        content={
                          <>
                            You can change the lookback window with the{" "}
                            <code>IMPORT_LIMIT_DAYS</code> environment variable.
                          </>
                        }
                      />
                    </>
                  ) : null}
                </>
              ) : null}
            </Text>
            {pagination}
          </Flex>
        </>
      )}
    </>
  );
};

export default ImportExperimentList;
