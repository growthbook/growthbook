import React, { FC, useCallback, useMemo, useState } from "react";
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
import { Trans, useLingui } from "@lingui/react/macro";
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
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Switch from "@/ui/Switch";
import LoadingOverlay from "@/components/LoadingOverlay";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import { generateVariationId } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import UITooltip from "@/ui/Tooltip";

const numberFormatter = new Intl.NumberFormat();

function QueryNames({ queries }: { queries: { id: string; name: string }[] }) {
  return (
    <>
      {queries.map((q, i) => (
        <React.Fragment key={q.id}>
          {i > 0 &&
            (i === queries.length - 1 ? (
              <>
                {" "}
                <Trans>and</Trans>{" "}
              </>
            ) : (
              ", "
            ))}
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
  const { t } = useLingui();
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
        : t`experiments`,
      id: item.trackingKey,
    }),
    [datasource, t],
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
  const [statusFilter, setStatusFilter] = useState<"" | "running" | "stopped">(
    "",
  );

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
      : (identifierTypes.find((type) => identifiersWithRows.has(type)) ??
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
        if (statusFilter && statusFilter !== status) {
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
    SortableTH,
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
    setStatusFilter("");
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
  const failedQueries = staleQueries.filter((q) =>
    lastRunQueries.some(
      (r) =>
        r.name === getPastExperimentQueryName(q.id) && r.status === "failed",
    ),
  );
  const skippedQueries = staleQueries.filter((q) => !failedQueries.includes(q));
  // A single query's last run, which dates its results.
  const staleResultsDate = (queries: { id: string }[]) => {
    if (queries.length !== 1) return null;
    const lastRunAt = data.experiments.exposureQueryRuns?.find(
      (r) => r.exposureQueryId === queries[0].id,
    )?.lastRunAt;
    return lastRunAt ? date(lastRunAt) : null;
  };
  const failedResultsDate = staleResultsDate(failedQueries);
  const skippedResultsDate = staleResultsDate(skippedQueries);
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
  const shownRows = items.length;
  const lookbackDays = data.lookbackDays;
  const lastUpdated = ago(data.experiments.runStarted ?? "");
  const config = data.experiments.config;
  const rangeStart = config ? date(lookbackStart ?? config.start) : null;
  const rangeEnd = config ? date(config.end) : null;
  const lookbackTooltip = !isCloud() ? (
    <Tooltip
      body={
        <Trans>
          You can change the lookback window with the{" "}
          <code>IMPORT_LIMIT_DAYS</code> environment variable.
        </Trans>
      }
    />
  ) : null;
  const viewQueriesLink = (onClick: () => void) => (
    <Link onClick={onClick}>
      <Trans>View queries</Trans>
    </Link>
  );

  return (
    <>
      <div className="row align-items-center mb-4">
        <div className="col-auto">
          {changeDatasource && supportedDatasources.length > 1 ? (
            <SelectField
              size="legacy"
              value={data.experiments.datasource}
              options={supportedDatasources.map((d) => {
                const isDefaultDataSource = d.id === defaultDataSource;
                return {
                  value: d.id,
                  label: `${d.name}${
                    d.description ? ` — ${d.description}` : ""
                  } ${isDefaultDataSource ? ` ${t`(default)`}` : ""}`,
                };
              })}
              className="portal-overflow-ellipsis"
              onChange={changeDatasource}
            />
          ) : (
            <>
              <div>
                <strong>{datasource?.name}</strong>
              </div>
              <div className="text-gray font-weight-normal small text-ellipsis">
                {datasource?.description}
              </div>
            </>
          )}
        </div>
        {hasStarted && (
          <div className="col-auto ml-auto">
            <div
              className="text-muted"
              style={{ fontSize: "0.8em" }}
              title={datetime(data.experiments.runStarted ?? "")}
            >
              <Trans>last updated {lastUpdated}</Trans>
            </div>
          </div>
        )}
        {datasource &&
          permissionsUtil.canRunPastExperimentQueries(datasource) && (
            <div className="col-auto">
              <RunQueriesButton
                cta={
                  data.experiments.latestData ? t`Get New Data` : t`Run Query`
                }
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
            </div>
          )}
      </div>
      {(runError || importFailed) && (
        <Callout status="error" my="3">
          {runError && (
            <p>
              <Trans>Could not start a new import: {runError}</Trans>
            </p>
          )}
          {importFailed && (
            <>
              <p>
                <Trans>Error importing experiments.</Trans>
              </p>
              {datasource?.id && (
                <>
                  {!!datasource?.dateUpdated &&
                  datasource?.dateUpdated > data?.experiments?.dateUpdated ? (
                    <p>
                      <Trans>
                        Your datasource&apos;s{" "}
                        <em>Experiment Assignment Queries</em> may have been
                        misconfigured. The datasource has been modified since
                        the last data refresh, so use the &apos;Get New
                        Data&apos; button above to check if the issue has been
                        resolved. Otherwise,{" "}
                        <Link href={`/datasources/${datasource.id}?openAll=1`}>
                          edit the datasource
                        </Link>
                        .
                      </Trans>
                    </p>
                  ) : (
                    <p>
                      <Trans>
                        Your datasource&apos;s{" "}
                        <em>Experiment Assignment Queries</em> may be
                        misconfigured.{" "}
                        <Link href={`/datasources/${datasource.id}?openAll=1`}>
                          Edit the datasource
                        </Link>
                        .
                      </Trans>
                    </p>
                  )}
                </>
              )}

              <span>
                <Trans>
                  <ViewAsyncQueriesButton
                    queries={
                      data.experiments.queries?.map((q) => q.query) ?? []
                    }
                    error={data.experiments.error}
                    ctaComponent={viewQueriesLink}
                  />{" "}
                  for more information.
                </Trans>
              </span>
            </>
          )}
        </Callout>
      )}
      {staleQueries.length > 0 && (
        <Callout status="warning" my="3">
          {failedQueries.length > 0 && (
            <>
              {failedQueries.length > 1 ? (
                <Trans>
                  <QueryNames queries={failedQueries} /> failed on the last
                  refresh, so their results may be out of date.
                </Trans>
              ) : failedResultsDate ? (
                <Trans>
                  <QueryNames queries={failedQueries} /> failed on the last
                  refresh, so its results are from {failedResultsDate}.
                </Trans>
              ) : (
                <Trans>
                  <QueryNames queries={failedQueries} /> failed on the last
                  refresh, so its results may be out of date.
                </Trans>
              )}{" "}
            </>
          )}
          {skippedQueries.length > 0 && (
            <>
              {skippedQueries.length > 1 ? (
                <Trans>
                  <QueryNames queries={skippedQueries} /> weren&apos;t included
                  in the last refresh, so their results may be out of date.
                </Trans>
              ) : skippedResultsDate ? (
                <Trans>
                  <QueryNames queries={skippedQueries} /> wasn&apos;t included
                  in the last refresh, so its results are from{" "}
                  {skippedResultsDate}.
                </Trans>
              ) : (
                <Trans>
                  <QueryNames queries={skippedQueries} /> wasn&apos;t included
                  in the last refresh, so its results may be out of date.
                </Trans>
              )}{" "}
            </>
          )}
          {staleQueriesUserCantRun.length > 0 &&
            (staleQueriesUserCantRun.length === 1 ? (
              <Trans>
                Refreshing <QueryNames queries={staleQueriesUserCantRun} />{" "}
                requires permission to run queries in its Projects.
              </Trans>
            ) : (
              <Trans>
                Refreshing <QueryNames queries={staleQueriesUserCantRun} />{" "}
                requires permission to run queries in their Projects.
              </Trans>
            ))}
        </Callout>
      )}
      {identifiersWithRows.size === 0 && (
        <div>
          {status === "running" ? (
            <LoadingSpinner />
          ) : !hasStarted ? (
            <>
              <p>
                <Trans>
                  Click the button above to query the past{" "}
                  <strong>{lookbackDays} days</strong> of data across all of
                  your Experiment Assignment queries.
                </Trans>{" "}
                {!isCloud() && (
                  <Trans>
                    You can adjust this lookback window with the{" "}
                    <code>IMPORT_LIMIT_DAYS</code> environment variable.
                  </Trans>
                )}
              </p>
              <p>
                <Trans>
                  After this initial import, you will be able to perform smaller
                  incremental queries to keep this list up-to-date.
                </Trans>
              </p>
            </>
          ) : (
            <>
              <h4>
                <Trans>No experiments found</Trans>
              </h4>
              <p>
                <Trans>
                  No past experiments were returned from this data source. If
                  you are expecting past experiments, check the following:
                </Trans>
              </p>
              <ul>
                <li>
                  <Trans>
                    Too old: this query only shows experiments from the last 12
                    months by default (you can adjust the import date limit from
                    the settings)
                  </Trans>
                </li>
                <li>
                  <Trans>
                    Not enough traffic: experiments are not shown if they had
                    fewer than 5 units per variation
                  </Trans>
                </li>
                <li>
                  <Trans>
                    Incorrect query: the experiment exposure query runs but is
                    not pulling the right data
                  </Trans>
                </li>
              </ul>
            </>
          )}
        </div>
      )}
      {identifiersWithRows.size > 0 && (
        <div>
          <h4>
            <Trans>Experiments</Trans>
          </h4>
          <p>
            {config ? (
              <Trans>
                These are all of the experiments we found in your datasource
                from <strong>{rangeStart}</strong> to{" "}
                <strong>{rangeEnd}</strong> {lookbackTooltip}.
              </Trans>
            ) : (
              <Trans>
                These are all of the experiments we found in your datasource .
              </Trans>
            )}
          </p>
          <div className="row mb-3 text-align-center bg-light border-top border-bottom">
            {identifierType !== null && identifierTypes.length > 1 && (
              <div className="col-auto">
                <SelectField
                  label={t`Identifier`}
                  labelClassName="small mb-0"
                  value={identifierType}
                  onChange={setSelectedIdentifierType}
                  options={identifierTypes.map((type) => ({
                    label: type,
                    value: type,
                  }))}
                />
              </div>
            )}
            <div className="col-auto">
              <label className="small mb-0">
                <Trans>Filter</Trans>
              </label>
              <Field
                size="legacy"
                placeholder={t`Search...`}
                type="search"
                {...searchInputProps}
              />
            </div>
            <div className="col-auto">
              <Field
                size="legacy"
                label={t`# Units`}
                labelClassName="small mb-0"
                type="number"
                min={0}
                step={1}
                prepend={<>&ge;</>}
                style={{ width: 80 }}
                value={minUsersFilter}
                onChange={(e) => {
                  setMinUsersFilter(e.target.value || "");
                }}
              />
            </div>
            <div className="col-auto">
              <Field
                size="legacy"
                label={t`Test Duration`}
                labelClassName="small mb-0"
                type="number"
                min={0}
                step={1}
                style={{ width: 60 }}
                value={minLengthFilter}
                onChange={(e) => {
                  setMinLengthFilter(e.target.value || "");
                }}
                prepend={<>&ge;</>}
                append={t`days`}
              />
            </div>
            <div className="col-auto">
              <Field
                size="legacy"
                label={t`# Variations`}
                labelClassName="small mb-0"
                type="number"
                min={1}
                step={1}
                style={{ width: 60 }}
                prepend={<>&ge;</>}
                value={minVariationsFilter}
                onChange={(e) => {
                  setMinVariationsFilter(e.target.value);
                }}
              />
            </div>
            <div className="col-auto">
              <SelectField
                size="legacy"
                label={t`Status`}
                labelClassName="small mb-0"
                options={[
                  { label: t`All`, value: "" },
                  { label: t`Running`, value: "running" },
                  { label: t`Stopped`, value: "stopped" },
                ]}
                value={statusFilter}
                onChange={(value) =>
                  setStatusFilter((value as "" | "stopped" | "running") || "")
                }
              />
            </div>
            <div className="col-auto align-self-center">
              <Switch
                id="hide-imported"
                label={t`Hide Imported`}
                value={alreadyImportedFilter}
                onChange={setAlreadyImportedFilter}
              />
            </div>
            <div className="col-auto align-self-center">
              <Switch
                id="dedupe-experiments"
                label={
                  <>
                    <span>
                      <Trans>Group by Experiment Id</Trans>
                    </span>{" "}
                    <Tooltip
                      body={t`How to handle experiments that appear in multiple Assignment Queries. If toggled ON, collapse them into a single row. If OFF, show each one in a separate row.`}
                    />
                  </>
                }
                value={dedupeFilter}
                onChange={setDedupeFilter}
              />
            </div>
          </div>
          <small>
            <Trans>
              Showing <strong>{shownRows}</strong> of{" "}
              <strong>{totalRows}</strong> experiments.
            </Trans>{" "}
            {items.length < totalRows && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  clearFilters();
                }}
              >
                <Trans>Clear all filters</Trans>
              </a>
            )}
          </small>
          <table className="table appbox">
            <thead>
              <tr>
                <SortableTH field="exposureQueryName">
                  <Trans>Assignment Query</Trans>
                </SortableTH>
                <SortableTH field="experimentName">
                  <Trans>Experiment Id</Trans>
                </SortableTH>
                <SortableTH field="startDate">
                  <Trans>Date Started</Trans>
                </SortableTH>
                <SortableTH field="endDate">
                  <Trans>Date Ended</Trans>
                </SortableTH>
                <SortableTH field="numVariations">
                  <Trans>Variations</Trans>
                </SortableTH>
                <SortableTH field="users">
                  <Trans>Approx Units</Trans>{" "}
                  <Tooltip
                    body={t`This count is approximate and does not de-duplicate units across days; therefore it is likely inflated. Once imported, the unit counts will be accurate.`}
                  />
                </SortableTH>
                <th>
                  <Trans>Traffic Split</Trans>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => {
                const key = dedupeFilter
                  ? e.trackingKey
                  : e.trackingKey + "::" + e.exposureQueryId;
                const existingId = data?.existing?.[key];

                return (
                  <tr key={key}>
                    <td style={{ wordBreak: "break-word" }}>
                      {e.exposureQueryName}
                    </td>
                    <td style={{ wordBreak: "break-word" }}>
                      {e.experimentName || e.trackingKey}
                    </td>
                    <td>
                      <Tooltip
                        body={
                          e.startOfRange
                            ? t`We only have partial data for this experiment since it was already running at the start of our query`
                            : ""
                        }
                      >
                        {date(e.startDate)}
                        {e.startOfRange ? "*" : ""}
                      </Tooltip>
                    </td>
                    <td>{date(e.endDate)}</td>
                    <td>{e.numVariations}</td>
                    <td>{numberFormatter.format(e.users)}</td>
                    <td style={{ maxWidth: 180 }}>
                      {e.weights.map((w) => Math.round(w * 100)).join(" / ")}
                    </td>
                    <td>
                      {existingId ? (
                        <Link href={`/experiment/${existingId}`}>
                          <Trans>imported</Trans>
                        </Link>
                      ) : existingId === null ? (
                        <UITooltip
                          content={t`Imported into a Project you don't have access to`}
                        >
                          <span tabIndex={0}>
                            <Text color="text-mid">
                              <Trans>imported</Trans>
                            </Text>
                          </span>
                        </UITooltip>
                      ) : (
                        <button
                          className={`btn btn-primary`}
                          onClick={(ev) => {
                            ev.preventDefault();
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
                          <Trans>Import</Trans>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {items.length <= 0 && (
                <tr>
                  <td colSpan={8}>
                    <Callout status="info">
                      {identifierType !== null &&
                      !identifiersWithRows.has(identifierType) ? (
                        <em>
                          <Trans>
                            No experiments found for {identifierType}.
                          </Trans>
                        </em>
                      ) : (
                        <em>
                          <Trans>
                            No experiments match your current filters.
                          </Trans>{" "}
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              clearFilters();
                            }}
                          >
                            <Trans>Clear all filters</Trans>
                          </a>
                        </em>
                      )}
                    </Callout>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {datasource &&
        permissionsUtil.canRunPastExperimentQueries(datasource) &&
        data.experiments.latestData &&
        status !== "running" && (
          <div className="float-right">
            <Tooltip
              body={
                <Trans>
                  This will wipe the above table and query the past{" "}
                  <strong>{lookbackDays} days</strong> of data from scratch. Use
                  the &apos;Get New Data&apos; button above to perform a more
                  efficient incremental query.
                </Trans>
              }
            >
              <a
                href="#"
                className="ml-2 btn btn-link"
                onClick={async (e) => {
                  e.preventDefault();
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
                <Trans>Full Refresh</Trans>
              </a>
            </Tooltip>
          </div>
        )}

      {showQueries && hasStarted && (
        <div>
          <ViewAsyncQueriesButton
            queries={
              data.experiments.queries?.length > 0
                ? data.experiments.queries.map((q) => q.query)
                : []
            }
            error={data.experiments.error}
            inline={true}
          />
        </div>
      )}
    </>
  );
};

export default ImportExperimentList;
