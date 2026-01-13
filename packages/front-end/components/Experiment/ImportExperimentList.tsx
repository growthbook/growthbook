import Link from "next/link";
import React, { FC, useCallback, useState } from "react";
import { PastExperimentsInterface } from "shared/types/past-experiments";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getValidDate, ago, date, datetime, daysBetween } from "shared/dates";
import { isProjectListValidForProject } from "shared/util";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { getExposureQuery } from "@/services/datasources";
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

const numberFormatter = new Intl.NumberFormat();

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
    existing: Record<string, string>;
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
  const [statusFilter, setStatusFilter] = useState<"" | "running" | "stopped">(
    "",
  );

  const [minVariationsFilter, setMinVariationsFilter] = useState("2");

  // Searching
  const filterResults = useCallback(
    (items: typeof pastExpArr) => {
      const rows = items.filter((e) => {
        if (minUsersFilter && e.users < (parseInt(minUsersFilter) || 0)) {
          return false;
        }
        if (alreadyImportedFilter) {
          const key = dedupeFilter
            ? e.trackingKey
            : e.trackingKey + "::" + e.exposureQueryId;
          if (data?.existing?.[key]) {
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
          daysBetween(e.startDate, e.endDate) < (parseInt(minLengthFilter) || 0)
        ) {
          return false;
        }

        if (
          minVariationsFilter &&
          e.numVariations < parseInt(minVariationsFilter)
        ) {
          return false;
        }

        // Passed all the filters, include it in the table
        return true;
      });

      // Group by trackingKey insteadd of trackingKey/exposureQueryId
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
    return <div className="alert alert-error">{error?.message}</div>;
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

  const totalRows = dedupeFilter
    ? new Set(pastExpArr.map((e) => e.trackingKey)).size
    : pastExpArr.length;

  return (
    <>
      <div className="row align-items-center mb-4">
        <div className="col-auto">
          {changeDatasource && supportedDatasources.length > 1 ? (
            <SelectField
              value={data.experiments.datasource}
              options={supportedDatasources.map((d) => {
                const isDefaultDataSource = d.id === defaultDataSource;
                return {
                  value: d.id,
                  label: `${d.name}${
                    d.description ? ` — ${d.description}` : ""
                  } ${isDefaultDataSource ? " (default)" : ""}`,
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
              last updated {ago(data.experiments.runStarted ?? "")}
            </div>
          </div>
        )}
        {datasource &&
          permissionsUtil.canRunPastExperimentQueries(datasource) && (
            <div className="col-auto">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await apiCall<{ id: string }>("/experiments/import", {
                    method: "POST",
                    body: JSON.stringify({
                      datasource: data.experiments.datasource,
                      force: true,
                    }),
                  });
                  await mutate();
                }}
              >
                <RunQueriesButton
                  cta={
                    data.experiments.latestData ? "Get New Data" : "Run Query"
                  }
                  cancelEndpoint={`/experiments/import/${data.experiments.id}/cancel`}
                  mutate={mutate}
                  model={data.experiments}
                  icon="refresh"
                />
              </form>
            </div>
          )}
      </div>
      {hasStarted && status === "failed" && (
        <>
          <Callout status="error" my="3">
            <p>Error importing experiments.</p>
            {datasource?.id && (
              <>
                {!!datasource?.dateUpdated &&
                datasource?.dateUpdated > data?.experiments?.dateUpdated ? (
                  <p>
                    Your datasource&apos;s{" "}
                    <em>Experiment Assignment Queries</em> may have been
                    misconfigured. The datasource has been modified since the
                    last data refresh, so use the &apos;Get New Data&apos;
                    button above to check if the issue has been resolved.
                    Otherwise,{" "}
                    <Link href={`/datasources/${datasource.id}?openAll=1`}>
                      edit the datasource
                    </Link>
                    .
                  </p>
                ) : (
                  <p>
                    Your datasource&apos;s{" "}
                    <em>Experiment Assignment Queries</em> may be misconfigured.{" "}
                    <Link href={`/datasources/${datasource.id}?openAll=1`}>
                      Edit the datasource
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
                  <a className="alert-link" href="#" onClick={onClick}>
                    View Queries
                  </a>
                )}
              />{" "}
              for more information.
            </span>
          </Callout>
        </>
      )}
      {totalRows === 0 && (
        <div>
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
      {totalRows > 0 && (
        <div>
          <h4>Experiments</h4>
          <p>
            These are all of the experiments we found in your datasource{" "}
            {data.experiments.config && (
              <>
                from <strong>{date(data.experiments.config.start)}</strong> to{" "}
                <strong>{date(data.experiments.config.end)}</strong>{" "}
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
          <div className="row mb-3 text-align-center bg-light border-top border-bottom">
            <div className="col-auto">
              <label className="small mb-0">Filter</label>
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </div>
            <div className="col-auto">
              <Field
                label="# Units"
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
                label="Test Duration"
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
                append="days"
              />
            </div>
            <div className="col-auto">
              <Field
                label="# Variations"
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
              <Field
                label="Status"
                labelClassName="small mb-0"
                options={[
                  {
                    display: "All",
                    value: "",
                  },
                  {
                    display: "Running",
                    value: "running",
                  },
                  {
                    display: "Stopped",
                    value: "stopped",
                  },
                ]}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(
                    (e.target.value as "" | "stopped" | "running") || "",
                  );
                }}
              />
            </div>
            <div className="col-auto align-self-center">
              <Switch
                id="hide-imported"
                label="Hide Imported"
                value={alreadyImportedFilter}
                onChange={setAlreadyImportedFilter}
              />
            </div>
            <div className="col-auto align-self-center">
              <Switch
                id="dedupe-experiments"
                label={
                  <>
                    <span>Group by Experiment Id</span>{" "}
                    <Tooltip body="How to handle experiments that appear in multiple Assignment Queries. If toggled ON, collapse them into a single row. If OFF, show each one in a separate row." />
                  </>
                }
                value={dedupeFilter}
                onChange={setDedupeFilter}
              />
            </div>
          </div>
          <small>
            Showing <strong>{items.length}</strong> of{" "}
            <strong>{totalRows}</strong> experiments.{" "}
            {items.length < totalRows && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  clearFilters();
                }}
              >
                Clear all filters
              </a>
            )}
          </small>
          <table className="table appbox">
            <thead>
              <tr>
                <SortableTH field="exposureQueryName">
                  Assignment Query
                </SortableTH>
                <SortableTH field="experimentName">Experiment Id</SortableTH>
                <SortableTH field="startDate">Date Started</SortableTH>
                <SortableTH field="endDate">Date Ended</SortableTH>
                <SortableTH field="numVariations">Variations</SortableTH>
                <SortableTH field="users">
                  Approx Units{" "}
                  <Tooltip body="This count is approximate and does not de-duplicate units across days; therefore it is likely inflated. Once imported, the unit counts will be accurate." />
                </SortableTH>
                <th>Traffic Split</th>
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
                            ? "We only have partial data for this experiment since it was already running at the start of our query"
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
                        <Link href={`/experiment/${existingId}`}>imported</Link>
                      ) : (
                        <button
                          className={`btn btn-primary`}
                          onClick={(ev) => {
                            ev.preventDefault();
                            const importObj: Partial<ExperimentInterfaceStringDates> =
                              {
                                name: e.experimentName || e.trackingKey,
                                trackingKey: e.trackingKey,
                                datasource: data?.experiments?.datasource,
                                exposureQueryId: e.exposureQueryId || "",
                                variations: e.variationKeys.map((vKey, i) => {
                                  let vName = e.variationNames?.[i] || vKey;
                                  // If the name is an integer, rename 0 to "Control" and anything else to "Variation {name}"
                                  if (vName.match(/^[0-9]{1,2}$/)) {
                                    vName =
                                      vName === "0"
                                        ? "Control"
                                        : `Variation ${vName}`;
                                  }
                                  return {
                                    name: vName,
                                    screenshots: [],
                                    description: "",
                                    key: vKey,
                                    id: generateVariationId(),
                                  };
                                }),
                                phases: [
                                  {
                                    coverage: 1,
                                    name: "Main",
                                    reason: "",
                                    variationWeights: e.weights,
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
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {items.length <= 0 && totalRows > 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="alert alert-info">
                      <em>
                        No experiments match your current filters.{" "}
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            clearFilters();
                          }}
                        >
                          Clear all filters
                        </a>
                      </em>
                    </div>
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
                <>
                  This will wipe the above table and query the past{" "}
                  <strong>{data.lookbackDays} days</strong> of data from
                  scratch. Use the &apos;Get New Data&apos; button above to
                  perform a more efficient incremental query.
                </>
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
                Full Refresh
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
