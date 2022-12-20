import Link from "next/link";
import React, { FC, useCallback, useState } from "react";
import { PastExperimentsInterface } from "back-end/types/past-experiments";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAddComputedFields, useSearch } from "@/services/search";
import {
  ago,
  date,
  datetime,
  daysBetween,
  getValidDate,
} from "@/services/dates";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { getExposureQuery } from "@/services/datasources";
import usePermissions from "@/hooks/usePermissions";
import useOrgSettings from "@/hooks/useOrgSettings";
import { isCloud } from "@/services/env";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Toggle from "@/components/Forms/Toggle";
import LoadingOverlay from "@/components/LoadingOverlay";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Tooltip from "@/components/Tooltip/Tooltip";

const numberFormatter = new Intl.NumberFormat();

const ImportExperimentList: FC<{
  onImport: (obj: Partial<ExperimentInterfaceStringDates>) => void;
  importId: string;
  showQueries?: boolean;
  changeDatasource?: (id: string) => void;
}> = ({ onImport, importId, showQueries = true, changeDatasource }) => {
  const { getDatasourceById, ready, datasources } = useDefinitions();
  const permissions = usePermissions();
  const { apiCall } = useAuth();
  const { data, error, mutate } = useApi<{
    experiments: PastExperimentsInterface;
    existing: Record<string, string>;
  }>(`/experiments/import/${importId}`);
  const datasource = getDatasourceById(data?.experiments?.datasource);

  const status = getQueryStatus(
    data?.experiments?.queries || [],
    data?.experiments?.error
  );
  const pastExpArr = useAddComputedFields(
    data?.experiments?.experiments,
    (item) => ({
      exposureQueryName: item.exposureQueryId
        ? getExposureQuery(datasource?.settings, item.exposureQueryId)?.name
        : "experiments",
    }),
    [datasource]
  );
  const { pastExperimentsMinLength } = useOrgSettings();

  const [minUsersFilter, setMinUsersFilter] = useState("100");
  const [minLengthFilter, setMinLengthFilter] = useState(
    `${pastExperimentsMinLength || 6}`
  );
  const [alreadyImportedFilter, setAlreadyImportedFilter] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"" | "running" | "stopped">(
    ""
  );

  // Searching
  const filterResults = useCallback(
    (items: typeof pastExpArr) => {
      return items.filter((e) => {
        if (minUsersFilter && e.users < (parseInt(minUsersFilter) || 0)) {
          return false;
        }
        if (alreadyImportedFilter && data?.existing?.[e.trackingKey]) {
          return false;
        }
        const status =
          daysBetween(e.endDate, new Date()) < 2 ? "running" : "stopped";
        if (statusFilter && statusFilter !== status) {
          return false;
        }
        if (
          minLengthFilter &&
          status === "stopped" &&
          daysBetween(e.startDate, e.endDate) < (parseInt(minLengthFilter) || 0)
        ) {
          return false;
        }
        // Passed all the filters, include it in the table
        return true;
      });
    },
    [
      alreadyImportedFilter,
      data?.existing,
      minLengthFilter,
      minUsersFilter,
      statusFilter,
    ]
  );
  const { items, searchInputProps, clear: clearSearch, SortableTH } = useSearch(
    {
      items: pastExpArr,
      searchFields: ["trackingKey", "experimentName", "exposureQueryName"],
      defaultSortField: "startDate",
      defaultSortDir: -1,
      localStorageKey: "past-experiments",
      filterResults,
    }
  );

  if (!importId) {
    return <LoadingOverlay />;
  }
  if (error) {
    return <div className="alert alert-error">{error?.message}</div>;
  }
  if (!data || !ready) {
    return <LoadingOverlay />;
  }

  const supportedDatasources = datasources.filter(
    (d) => d.properties.pastExperiments
  );

  function clearFilters() {
    setAlreadyImportedFilter(false);
    setMinUsersFilter("0");
    setMinLengthFilter("0");
    setStatusFilter("");
    clearSearch();
  }

  return (
    <>
      <div className="row align-items-center mb-4">
        <div className="col-auto">
          {changeDatasource && supportedDatasources.length > 1 ? (
            <SelectField
              value={data.experiments.datasource}
              options={supportedDatasources.map((d) => ({
                value: d.id,
                label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
              }))}
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
        <div className="col-auto ml-auto">
          <div
            className="text-muted"
            style={{ fontSize: "0.8em" }}
            title={datetime(data.experiments.runStarted)}
          >
            last updated {ago(data.experiments.runStarted)}
          </div>
        </div>
        {permissions.check("runQueries", "") && (
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
                cta="Refresh List"
                initialStatus={getQueryStatus(
                  data.experiments.queries || [],
                  data.experiments.error
                )}
                statusEndpoint={`/experiments/import/${data.experiments.id}/status`}
                cancelEndpoint={`/experiments/import/${data.experiments.id}/cancel`}
                onReady={async () => {
                  await mutate();
                }}
              />
            </form>
          </div>
        )}
      </div>
      {status === "failed" && (
        <>
          <div className="alert alert-danger my-3">
            <p>Error importing experiments.</p>
            {datasource.id && (
              <p>
                Your datasource&apos;s <em>Experiment Assignment Queries</em>{" "}
                may be misconfigured.{" "}
                <Link href={`/datasources/${datasource.id}?openAll=1`}>
                  Edit the datasource
                </Link>
              </p>
            )}
            <span>View Queries (below) for more information.</span>
          </div>
        </>
      )}
      {pastExpArr.length === 0 && status !== "failed" && (
        <div>
          <h4>No experiments found</h4>
          <p>
            No past experiments were returned from this data source. If you are
            expecting past experiments, check the following:
          </p>
          <ul>
            <li>
              Too old: this query only shows experiments from the last 12 months
              by default (you can adjust the import date limit from the
              settings)
            </li>
            <li>
              Not enough traffic: experiments are not shown if they had less
              than 5 users per variation
            </li>
            <li>
              Incorrect query: the experiment exposure query runs but is not
              pulling the right data
            </li>
          </ul>
        </div>
      )}
      {pastExpArr.length > 0 && (
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
                label="Min Users"
                labelClassName="small mb-0"
                type="number"
                min={0}
                step={1}
                style={{ width: 80 }}
                value={minUsersFilter}
                onChange={(e) => {
                  setMinUsersFilter(e.target.value || "");
                }}
              />
            </div>
            <div className="col-auto">
              <Field
                label="Min Duration"
                labelClassName="small mb-0"
                type="number"
                min={0}
                step={1}
                style={{ width: 60 }}
                value={minLengthFilter}
                onChange={(e) => {
                  setMinLengthFilter(e.target.value || "");
                }}
                append="days"
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
                    (e.target.value as "" | "stopped" | "running") || ""
                  );
                }}
              />
            </div>
            <div className="col-auto align-self-center">
              <Toggle
                id="hide-imported"
                value={alreadyImportedFilter}
                setValue={setAlreadyImportedFilter}
              />{" "}
              Hide Imported
            </div>
          </div>
          <small>
            Showing <strong>{items.length}</strong> of{" "}
            <strong>{pastExpArr.length}</strong> experiments.{" "}
            {items.length < pastExpArr.length && (
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
                <SortableTH field="exposureQueryName">Source</SortableTH>
                <SortableTH field="experimentName">Experiment</SortableTH>
                <SortableTH field="startDate">Date Started</SortableTH>
                <SortableTH field="endDate">Date Ended</SortableTH>
                <SortableTH field="numVariations">Variations</SortableTH>
                <SortableTH field="users">Total Users</SortableTH>
                <th>Traffic Split</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => {
                return (
                  <tr key={e.trackingKey}>
                    <td>{e.exposureQueryName}</td>
                    <td>{e.experimentName || e.trackingKey}</td>
                    <td>{date(e.startDate)}</td>
                    <td>{date(e.endDate)}</td>
                    <td>{e.numVariations}</td>
                    <td>{numberFormatter.format(e.users)}</td>
                    <td>
                      {e.weights.map((w) => Math.round(w * 100)).join("/")}
                    </td>
                    <td>
                      {data?.existing?.[e.trackingKey] ? (
                        <Link
                          href={`/experiment/${data.existing[e.trackingKey]}`}
                        >
                          <a>imported</a>
                        </Link>
                      ) : (
                        <button
                          className={`btn btn-primary`}
                          onClick={(ev) => {
                            ev.preventDefault();
                            const importObj: Partial<ExperimentInterfaceStringDates> = {
                              name: e.experimentName || e.trackingKey,
                              trackingKey: e.trackingKey,
                              datasource: data?.experiments?.datasource,
                              exposureQueryId: e.exposureQueryId || "",
                              variations: e.variationKeys.map((vKey, i) => {
                                let vName = e.variationNames[i] || vKey;
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
                                };
                              }),
                              phases: [
                                {
                                  coverage: 1,
                                  phase: "main",
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
              {items.length <= 0 && pastExpArr.length > 0 && (
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
      {showQueries && (
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
