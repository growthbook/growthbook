import { date, getValidDate } from "../../services/dates";
import Link from "next/link";
//import Button from "../Button";
import React, { FC } from "react";
import { PastExperimentsInterface } from "back-end/types/past-experiments";
import { useSearch } from "../../services/search";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useDefinitions } from "../../services/DefinitionsContext";
import { useAuth } from "../../services/auth";
import useApi from "../../hooks/useApi";
import RunQueriesButton, { getQueryStatus } from "../Queries/RunQueriesButton";
import LoadingOverlay from "../LoadingOverlay";
import ViewAsyncQueriesButton from "../Queries/ViewAsyncQueriesButton";
const numberFormatter = new Intl.NumberFormat();

const ImportExperimentList: FC<{
  onImport: (obj: Partial<ExperimentInterfaceStringDates>) => void;
  importId: string;
  searchLimit?: number;
  showQueries?: boolean;
  //useForm?: boolean;
}> = ({
  onImport,
  importId,
  searchLimit = 4,
  showQueries = true,
  //useForm = true,
}) => {
  const { getDatasourceById, ready } = useDefinitions();
  const { apiCall } = useAuth();
  const { data, error, mutate } = useApi<{
    experiments: PastExperimentsInterface;
    existing: Record<string, string>;
  }>(`/experiments/import/${importId}`);

  const status = getQueryStatus(
    data?.experiments?.queries || [],
    data?.experiments?.error
  );
  const pastExpArr = data?.experiments?.experiments || [];
  const existing = data?.existing || [];

  const {
    list: filteredExperiments,
    searchInputProps,
  } = useSearch(pastExpArr || [], ["trackingKey"]);

  filteredExperiments.sort((a, b) => {
    if (a.startDate < b.startDate) return 1;
    else if (a.startDate > b.startDate) return -1;
    return 0;
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

  return (
    <>
      <h2>Import Experiments</h2>
      <p>
        From datasource:{" "}
        <strong>{getDatasourceById(data.experiments.datasource).name}</strong>
      </p>
      <div className="row mb-3">
        <div className="col-auto">
          <form
            onSubmit={async (e) => {
              console.log("import exp form submitted");
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
        {showQueries && (
          <div className="col-auto">
            <ViewAsyncQueriesButton
              queries={
                data.experiments.queries?.length > 0
                  ? data.experiments.queries.map((q) => q.query)
                  : []
              }
              error={data.experiments.error}
            />
          </div>
        )}
      </div>
      {status === "failed" && (
        <div className="alert alert-danger my-3">
          Error importing experiments. View Queries for more info
        </div>
      )}
      {pastExpArr.length > 0 && (
        <div>
          <h3>Available Experiments</h3>
          <p>
            These are all of the experiments we found in your datasource for the
            past 12 months.
          </p>
          {pastExpArr.length > searchLimit && (
            <div className="row mb-3">
              <div className="col-lg-3 col-md-4 col-6">
                <input
                  type="search"
                  className=" form-control"
                  placeholder="Search"
                  aria-controls="dtBasicExample"
                  {...searchInputProps}
                />
              </div>
            </div>
          )}
          <table className="table appbox">
            <thead>
              <tr>
                <th>Experiment Id</th>
                <th>Date Started</th>
                <th>Date Ended</th>
                <th>Number of Variations</th>
                <th>Total Users</th>
                <th>Traffic Split</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredExperiments.map((e) => {
                return (
                  <tr key={e.trackingKey}>
                    <td>{e.trackingKey}</td>
                    <td>{date(e.startDate)}</td>
                    <td>{date(e.endDate)}</td>
                    <td>{e.numVariations}</td>
                    <td>{numberFormatter.format(e.users)}</td>
                    <td>
                      {e.weights.map((w) => Math.round(w * 100)).join("/")}
                    </td>
                    <td>
                      {existing?.[e.trackingKey] ? (
                        <Link href={`/experiment/${existing[e.trackingKey]}`}>
                          <a>imported</a>
                        </Link>
                      ) : (
                        <button
                          className={`btn btn-primary`}
                          onClick={(ev) => {
                            ev.preventDefault();
                            const importObj: Partial<ExperimentInterfaceStringDates> = {
                              name: e.trackingKey,
                              trackingKey: e.trackingKey,
                              datasource: data?.experiments?.datasource,
                              variations: e.variationKeys.map((v) => {
                                const vInt = parseInt(v);
                                const name = !Number.isNaN(vInt)
                                  ? vInt == 0
                                    ? "Control"
                                    : `Variation ${vInt}`
                                  : v;
                                return {
                                  name,
                                  screenshots: [],
                                  description: "",
                                  key: v,
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
                            console.log("firing onimport");
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
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

export default ImportExperimentList;
