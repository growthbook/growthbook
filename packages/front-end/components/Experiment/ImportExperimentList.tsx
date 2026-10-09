import React, { FC, ReactNode, useCallback, useMemo, useState } from "react";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { PiDotsThreeVertical, PiMagnifyingGlass } from "react-icons/pi";
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
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import LoadingOverlay from "@/components/LoadingOverlay";
import LoadingSpinner from "@/components/LoadingSpinner";
import Tooltip from "@/components/Tooltip/Tooltip";
import { FilterHeading, FilterItem } from "@/components/Search/SearchFilters";
import { generateVariationId } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Modal from "@/ui/Modal";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import Heading from "@/ui/Heading";
import Pagination from "@/ui/Pagination";
import { Popover } from "@/ui/Popover";
import { Select, SelectItem } from "@/ui/Select";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

const numberFormatter = new Intl.NumberFormat();
const PAGE_SIZE = 20;

type RowStatus = "running" | "stopped" | "imported";
type Tab = "all" | RowStatus;

const STATUS_BADGES: Record<
  RowStatus,
  { label: string; color: "green" | "gray" | "violet" }
> = {
  running: { label: "Running", color: "green" },
  stopped: { label: "Stopped", color: "gray" },
  imported: { label: "Imported", color: "violet" },
};

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

function getImportValue(
  e: PastExperiment,
  datasource: string,
): Partial<ExperimentInterfaceStringDates> {
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
  return {
    name: e.experimentName || e.trackingKey,
    trackingKey: e.trackingKey,
    datasource,
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
          getValidDate(e.startDate).toISOString().substr(0, 10) + "T00:00:00Z",
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
    // Default to stopped if the last data was more than 3 days ago
    status:
      getValidDate(e.endDate).getTime() < Date.now() - 72 * 60 * 60 * 1000
        ? "stopped"
        : "running",
  };
}

const ImportExperimentList: FC<{
  onImport: (obj: Partial<ExperimentInterfaceStringDates>) => void;
  importId: string;
  changeDatasource: (id: string) => void;
  footer: ReactNode;
}> = ({ onImport, importId, changeDatasource, footer }) => {
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
  const defaultMinLength = `${pastExperimentsMinLength || 2}`;

  const [minUsersFilter, setMinUsersFilter] = useLocalStorage(
    "pastImportNumUsersFilter",
    "100",
  );
  const [minLengthFilter, setMinLengthFilter] = useLocalStorage(
    "pastImportMinLengthFilter",
    defaultMinLength,
  );
  const [minVariationsFilter, setMinVariationsFilter] = useState("2");
  const [dedupeFilter, setDedupeFilter] = useState(true);
  const [excludedQueryIds, setExcludedQueryIds] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState(1);
  const [openFilter, setOpenFilter] = useState("");
  const [showQueries, setShowQueries] = useState(false);
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

  const getExistingId = useCallback(
    (e: PastExperiment) =>
      data?.existing?.[
        dedupeFilter ? e.trackingKey : e.trackingKey + "::" + e.exposureQueryId
      ],
    [data?.existing, dedupeFilter],
  );
  const getRowStatus = useCallback(
    (e: PastExperiment): RowStatus => {
      if (getExistingId(e) !== undefined) return "imported";
      return daysBetween(e.endDate, new Date()) < 2 ? "running" : "stopped";
    },
    [getExistingId],
  );

  // Searching
  const filterResults = useCallback(
    (items: typeof pastExpArr) => {
      const rows = items.filter((e) => {
        if (!isRowAvailable(e)) return false;
        if (excludedQueryIds.includes(e.exposureQueryId)) return false;
        if (
          minUsersFilter &&
          e.users < parseIntWithDefault(minUsersFilter, 0)
        ) {
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
      dedupeFilter,
      excludedQueryIds,
      isRowAvailable,
      minLengthFilter,
      minUsersFilter,
      minVariationsFilter,
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
    // The modal opens over the experiments list, which owns the URL's `q`
    disableUrlSearchTerm: true,
  });

  // How far back every query in view has data
  const lookbackStart = inScopeQueries.reduce<Date | null>((latest, q) => {
    const start = data?.experiments?.exposureQueryRuns?.find(
      (r) => r.exposureQueryId === q.id,
    )?.start;
    if (!start) return latest;
    const d = getValidDate(start);
    return !latest || d > latest ? d : latest;
  }, null);

  const description = (
    <>
      Experiments your Experiment Assignment Queries recorded
      {data?.experiments?.config ? (
        <>
          {" "}
          from {date(lookbackStart ?? data.experiments.config.start)} to{" "}
          {date(data.experiments.config.end)}
        </>
      ) : (
        <> in the past {data?.lookbackDays ?? 365} days</>
      )}
      .
      {!isCloud() && (
        <>
          {" "}
          <Tooltip
            body={
              <>
                You can change the lookback window with the{" "}
                <code>IMPORT_LIMIT_DAYS</code> environment variable.
              </>
            }
          />
        </>
      )}
    </>
  );

  const layout = (headerAction: ReactNode, body: ReactNode) => (
    <>
      <Modal.Header>
        <Modal.Title>Import Experiment</Modal.Title>
        {headerAction}
      </Modal.Header>
      <Modal.Description>{description}</Modal.Description>
      <Modal.Body>{body}</Modal.Body>
      {footer}
    </>
  );

  if (error) {
    return layout(null, <Callout status="error">{error.message}</Callout>);
  }
  if (!data || !ready) {
    return layout(null, <LoadingOverlay />);
  }

  const supportedDatasources = datasources
    .filter((d) => d?.properties?.pastExperiments)
    .filter(
      (d) =>
        d.id === data.experiments.datasource ||
        isProjectListValidForProject(d.projects, project),
    );

  const defaultThresholds = {
    units: "100",
    length: defaultMinLength,
    variations: "2",
  };
  const activeThresholds = [
    parseIntWithDefault(minUsersFilter, 0) > 0,
    parseIntWithDefault(minLengthFilter, 0) > 0,
    parseIntWithDefault(minVariationsFilter, 0) > 1,
  ].filter(Boolean).length;

  function clearFilters() {
    setMinUsersFilter("0");
    setMinLengthFilter("0");
    setMinVariationsFilter("0");
    setExcludedQueryIds([]);
    clearSearch();
    setPage(1);
  }

  const hasStarted = data.experiments.queries.length > 0;
  // Unlike getQueryStatus, an import refresh only fails when every query does.
  const importFailed =
    hasStarted &&
    status !== "running" &&
    (!!data.experiments.error ||
      data.experiments.queries.every((q) => q.status === "failed"));
  const canRunQueries =
    !!datasource && permissionsUtil.canRunPastExperimentQueries(datasource);

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
  const staleQueriesUserCantRun = datasource
    ? staleQueries.filter(
        (q) => !permissionsUtil.canRunPastExperimentQuery(q, datasource),
      )
    : [];

  const identifierRows = pastExpArr.filter(isRowAvailable);
  const totalRows = dedupeFilter
    ? new Set(identifierRows.map((e) => e.trackingKey)).size
    : identifierRows.length;
  const identifierCounts = new Map(
    identifierTypes.map((t) => [
      t,
      new Set(
        pastExpArr
          .filter((e) => isRowInScope(e) && e.identifierType === t)
          .map((e) => e.trackingKey),
      ).size,
    ]),
  );
  const identifierQueries = inScopeQueries.filter(
    (q) =>
      identifierType === null ||
      getExposureQueryIdentifierTypes(q).includes(identifierType),
  );

  const tabCounts: Record<Tab, number> = {
    all: items.length,
    running: 0,
    stopped: 0,
    imported: 0,
  };
  items.forEach((e) => tabCounts[getRowStatus(e)]++);
  const tabItems =
    tab === "all" ? items : items.filter((e) => getRowStatus(e) === tab);
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(tabItems.length / PAGE_SIZE)),
  );
  const pageItems = tabItems.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const runFullRefresh = async () => {
    await apiCall<{ id: string }>("/experiments/import", {
      method: "POST",
      body: JSON.stringify({
        datasource: data.experiments.datasource,
        force: true,
        refresh: true,
      }),
    });
    await mutate();
  };

  const headerAction = (
    <Flex align="center" gap="3">
      {hasStarted && (
        <Text
          size="sm"
          color="text-low"
          title={datetime(data.experiments.runStarted ?? "")}
        >
          Updated {ago(data.experiments.runStarted ?? "")}
        </Text>
      )}
      {canRunQueries && (
        <RunQueriesButton
          cta={data.experiments.latestData ? "Refresh" : "Run query"}
          cancelEndpoint={`/experiments/import/${data.experiments.id}/cancel`}
          mutate={mutate}
          model={data.experiments}
          icon="refresh"
          radixVariant="outline"
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
      {hasStarted && (
        <DropdownMenu
          menuPlacement="end"
          trigger={
            <IconButton
              variant="ghost"
              size="2"
              aria-label="More query actions"
            >
              <PiDotsThreeVertical size={18} />
            </IconButton>
          }
        >
          <DropdownMenuItem onClick={() => setShowQueries(true)}>
            View queries
          </DropdownMenuItem>
          {canRunQueries &&
            data.experiments.latestData &&
            status !== "running" && (
              <DropdownMenuItem
                confirmation={{
                  confirmationTitle: "Full refresh",
                  cta: "Full refresh",
                  getConfirmationContent: async () =>
                    `This clears the list and queries the past ${data.lookbackDays} days from scratch. Refresh only fetches new data and is faster.`,
                  submit: runFullRefresh,
                }}
              >
                Full refresh
              </DropdownMenuItem>
            )}
        </DropdownMenu>
      )}
    </Flex>
  );

  const body = (
    <>
      {showQueries && (
        <AsyncQueriesModal
          queries={data.experiments.queries.map((q) => q.query)}
          savedQueries={[]}
          error={data.experiments.error}
          close={() => setShowQueries(false)}
        />
      )}
      {supportedDatasources.length > 1 && (
        <Box mb="4">
          <Select
            label="Data Source"
            labelSize="sm"
            size="sm"
            value={data.experiments.datasource}
            setValue={changeDatasource}
            style={{ minWidth: 260 }}
          >
            {supportedDatasources.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
                {d.description ? ` — ${d.description}` : ""}
                {d.id === defaultDataSource ? " (default)" : ""}
              </SelectItem>
            ))}
          </Select>
        </Box>
      )}
      {(runError || importFailed) && (
        <Callout status="error" mb="4">
          {runError && <p>Could not start a new import: {runError}</p>}
          {importFailed && (
            <>
              <p>Error importing experiments.</p>
              {datasource?.id && (
                <p>
                  Your Data Source&apos;s <em>Experiment Assignment Queries</em>{" "}
                  may be misconfigured.{" "}
                  {!!datasource.dateUpdated &&
                    datasource.dateUpdated > data.experiments.dateUpdated && (
                      <>
                        The Data Source has changed since the last refresh, so
                        refreshing again may fix it.{" "}
                      </>
                    )}
                  <Link href={`/datasources/${datasource.id}?openAll=1`}>
                    Edit the Data Source
                  </Link>{" "}
                  or{" "}
                  <Link onClick={() => setShowQueries(true)}>view queries</Link>{" "}
                  for more information.
                </p>
              )}
            </>
          )}
        </Callout>
      )}
      {staleQueries.length > 0 && (
        <Callout status="warning" mb="4">
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
      {identifiersWithRows.size === 0 ? (
        status === "running" ? (
          <Flex justify="center" py="6">
            <LoadingSpinner />
          </Flex>
        ) : !hasStarted ? (
          <Flex direction="column" align="center" gap="2" py="6">
            <Heading as="h3" size="md">
              Find Experiments You&apos;ve Already Run
            </Heading>
            <Text as="p" align="center" color="text-mid">
              Run the query above to search the past {data.lookbackDays} days of
              your Experiment Assignment Queries. Later refreshes only fetch new
              data.
            </Text>
          </Flex>
        ) : (
          <Box py="4">
            <Heading as="h3" size="md" mb="2">
              No Experiments Found
            </Heading>
            <p>
              No past experiments were returned from this Data Source. If you
              are expecting past experiments, check the following:
            </p>
            <ul>
              <li>
                Too old: only experiments from the past {data.lookbackDays} days
                are searched
              </li>
              <li>
                Not enough traffic: experiments are not shown if they had fewer
                than 5 units per variation
              </li>
              <li>
                Incorrect query: the experiment assignment query runs but is not
                pulling the right data
              </li>
            </ul>
          </Box>
        )
      ) : (
        <>
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as Tab);
              setPage(1);
            }}
            mb="3"
          >
            <TabsList>
              {(["all", "running", "stopped", "imported"] as const).map((t) => (
                <TabsTrigger key={t} value={t}>
                  {t === "all" ? "All" : STATUS_BADGES[t].label}
                  <Text size="sm" color="text-low" ml="2">
                    {tabCounts[t]}
                  </Text>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Flex justify="between" align="center" gap="3" wrap="wrap" mb="3">
            <Box style={{ width: 300 }}>
              <TextField
                type="search"
                placeholder="Search experiments..."
                aria-label="Search experiments"
                prepend={<PiMagnifyingGlass />}
                {...searchInputProps}
              />
            </Box>
            <Flex align="center" gap="4">
              {identifierType !== null && identifierTypes.length > 1 && (
                <DropdownMenu
                  variant="soft"
                  open={openFilter === "identifier"}
                  onOpenChange={(o) => setOpenFilter(o ? "identifier" : "")}
                  menuPlacement="end"
                  trigger={FilterHeading({
                    heading: (
                      <>
                        Identifier:&nbsp;
                        <Text mono weight="regular">
                          {identifierType}
                        </Text>
                      </>
                    ),
                    open: openFilter === "identifier",
                  })}
                >
                  <DropdownMenuLabel>Count units by</DropdownMenuLabel>
                  {identifierTypes.map((t) => (
                    <DropdownMenuItem
                      key={t}
                      onClick={() => {
                        setSelectedIdentifierType(t);
                        setPage(1);
                      }}
                    >
                      <FilterItem
                        exists={t === identifierType}
                        item={
                          <Flex justify="between" gap="5">
                            <Text mono>{t}</Text>
                            <Text size="sm" color="text-low">
                              {identifierCounts.get(t) || "none found"}
                            </Text>
                          </Flex>
                        }
                      />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenu>
              )}
              {identifierQueries.length > 1 && (
                <Popover
                  open={openFilter === "query"}
                  onOpenChange={(o) => setOpenFilter(o ? "query" : "")}
                  align="end"
                  showArrow={false}
                  contentStyle={{ padding: "12px 16px", width: 300 }}
                  trigger={FilterHeading({
                    heading: (
                      <>
                        Assignment query
                        {excludedQueryIds.length > 0 && (
                          <Badge
                            label={`${identifierQueries.length - excludedQueryIds.length}`}
                            size="xs"
                            radius="full"
                            ml="1"
                          />
                        )}
                      </>
                    ),
                    open: openFilter === "query",
                  })}
                  content={
                    <Flex direction="column" gap="2">
                      <Text size="sm" color="text-low">
                        Filter by assignment query
                      </Text>
                      {identifierQueries.map((q) => (
                        <Checkbox
                          key={q.id}
                          label={q.name}
                          value={!excludedQueryIds.includes(q.id)}
                          setValue={(v) => {
                            setExcludedQueryIds(
                              v
                                ? excludedQueryIds.filter((id) => id !== q.id)
                                : [...excludedQueryIds, q.id],
                            );
                            setPage(1);
                          }}
                        />
                      ))}
                      <Separator size="4" my="1" />
                      <Checkbox
                        label="Separate row per query"
                        description="Off: an experiment found by several queries shows once, using the query with the most units."
                        value={!dedupeFilter}
                        setValue={(v) => setDedupeFilter(!v)}
                      />
                    </Flex>
                  }
                />
              )}
              <Popover
                open={openFilter === "thresholds"}
                onOpenChange={(o) => setOpenFilter(o ? "thresholds" : "")}
                align="end"
                showArrow={false}
                contentStyle={{ padding: "16px", width: 280 }}
                trigger={FilterHeading({
                  heading: (
                    <>
                      Thresholds
                      {activeThresholds > 0 && (
                        <Badge
                          label={`${activeThresholds}`}
                          size="xs"
                          radius="full"
                          ml="1"
                        />
                      )}
                    </>
                  ),
                  open: openFilter === "thresholds",
                })}
                content={
                  <Flex direction="column" gap="3">
                    <Text size="sm" color="text-low">
                      Hide experiments below these minimums
                    </Text>
                    <TextField
                      label="Units"
                      labelSize="sm"
                      size="sm"
                      type="number"
                      min={0}
                      step={1}
                      prepend="≥"
                      value={minUsersFilter}
                      onChange={(e) => {
                        setMinUsersFilter(e.target.value || "");
                        setPage(1);
                      }}
                    />
                    <TextField
                      label="Duration"
                      labelSize="sm"
                      size="sm"
                      type="number"
                      min={0}
                      step={1}
                      prepend="≥"
                      append="days"
                      value={minLengthFilter}
                      onChange={(e) => {
                        setMinLengthFilter(e.target.value || "");
                        setPage(1);
                      }}
                    />
                    <TextField
                      label="Variations"
                      labelSize="sm"
                      size="sm"
                      type="number"
                      min={1}
                      step={1}
                      prepend="≥"
                      value={minVariationsFilter}
                      onChange={(e) => {
                        setMinVariationsFilter(e.target.value);
                        setPage(1);
                      }}
                    />
                    <Box>
                      <Link
                        size="sm"
                        onClick={() => {
                          setMinUsersFilter(defaultThresholds.units);
                          setMinLengthFilter(defaultThresholds.length);
                          setMinVariationsFilter(defaultThresholds.variations);
                          setPage(1);
                        }}
                      >
                        Reset to defaults
                      </Link>
                    </Box>
                  </Flex>
                }
              />
            </Flex>
          </Flex>
          <Table variant="surface">
            <TableHeader>
              <TableRow>
                <SortableTableColumnHeader field="experimentName">
                  Experiment
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="exposureQueryName">
                  Assignment query
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="startDate">
                  Dates
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="numVariations">
                  Variations
                </SortableTableColumnHeader>
                <SortableTableColumnHeader field="users">
                  Approx units{" "}
                  <Tooltip body="This count is approximate and does not de-duplicate units across days; therefore it is likely inflated. Once imported, the unit counts will be accurate." />
                </SortableTableColumnHeader>
                <TableColumnHeader>Status</TableColumnHeader>
                <TableColumnHeader />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((e) => {
                const existingId = getExistingId(e);
                const rowStatus = STATUS_BADGES[getRowStatus(e)];
                return (
                  <TableRow
                    key={
                      dedupeFilter
                        ? e.trackingKey
                        : e.trackingKey + "::" + e.exposureQueryId
                    }
                  >
                    <TableCell style={{ wordBreak: "break-word" }}>
                      <Text weight="medium">
                        {e.experimentName || e.trackingKey}
                      </Text>
                      {!!e.experimentName &&
                        e.experimentName !== e.trackingKey && (
                          <Text as="div" size="sm" color="text-low" mono>
                            {e.trackingKey}
                          </Text>
                        )}
                    </TableCell>
                    <TableCell style={{ wordBreak: "break-word" }}>
                      {e.exposureQueryName}
                    </TableCell>
                    <TableCell style={{ whiteSpace: "nowrap" }}>
                      <Tooltip
                        body={
                          e.startOfRange
                            ? "We only have partial data for this experiment since it was already running at the start of our query"
                            : ""
                        }
                      >
                        {date(e.startDate)}
                        {e.startOfRange ? "*" : ""} – {date(e.endDate)}
                      </Tooltip>
                      <Text as="div" size="sm" color="text-low">
                        {daysBetween(e.startDate, e.endDate)} days
                      </Text>
                    </TableCell>
                    <TableCell>
                      {e.numVariations}{" "}
                      <Text size="sm" color="text-low" ml="1">
                        {e.weights.map((w) => Math.round(w * 100)).join(" / ")}
                      </Text>
                    </TableCell>
                    <TableCell>{numberFormatter.format(e.users)}</TableCell>
                    <TableCell>
                      <Badge
                        label={rowStatus.label}
                        color={rowStatus.color}
                        variant="soft"
                      />
                    </TableCell>
                    <TableCell style={{ textAlign: "right" }}>
                      {existingId ? (
                        <Link href={`/experiment/${existingId}`}>View</Link>
                      ) : existingId === null ? (
                        <Tooltip body="Imported into a Project you don't have access to">
                          <Text size="sm" color="text-low">
                            No access
                          </Text>
                        </Tooltip>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() =>
                            onImport(
                              getImportValue(e, data.experiments.datasource),
                            )
                          }
                        >
                          Import
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {pageItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Text as="div" align="center" color="text-mid">
                      No experiments match your current filters.{" "}
                      <Link onClick={clearFilters}>Clear filters</Link>
                    </Text>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Flex justify="between" align="center" gap="3" mt="3">
            <Text size="sm" color="text-mid">
              {items.length < totalRows ? (
                <>
                  <strong>{items.length}</strong> of{" "}
                  <strong>{totalRows}</strong> experiments match your filters.{" "}
                  <Link onClick={clearFilters}>Clear filters</Link>
                </>
              ) : (
                <>
                  <strong>{totalRows}</strong> experiments
                </>
              )}
            </Text>
            {tabItems.length > PAGE_SIZE && (
              <Pagination
                numItemsTotal={tabItems.length}
                perPage={PAGE_SIZE}
                currentPage={currentPage}
                onPageChange={setPage}
              />
            )}
          </Flex>
        </>
      )}
    </>
  );

  return layout(headerAction, body);
};

export default ImportExperimentList;
