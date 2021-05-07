import Link from "next/link";
import { useRouter } from "next/router";
import { FC, useState } from "react";
import Button from "../../../components/Button";
import NewExperimentForm from "../../../components/Experiment/NewExperimentForm";
import LoadingOverlay from "../../../components/LoadingOverlay";
import RunQueriesButton, {
  getQueryStatus,
} from "../../../components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "../../../components/Queries/ViewAsyncQueriesButton";
import useApi from "../../../hooks/useApi";
import useDatasources from "../../../hooks/useDatasources";
import { useAuth } from "../../../services/auth";
import { date } from "../../../services/dates";
import { PastExperimentsInterface } from "back-end/types/past-experiments";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";

const numberFormatter = new Intl.NumberFormat();

const ImportPage: FC = () => {
  const router = useRouter();
  const { id } = router.query;

  const [
    create,
    setCreate,
  ] = useState<null | Partial<ExperimentInterfaceStringDates>>(null);

  const { getById, ready } = useDatasources();

  const { apiCall } = useAuth();

  const { data, error, mutate } = useApi<{
    experiments: PastExperimentsInterface;
    existing: Record<string, string>;
  }>(`/experiments/import/${id}`);

  if (error) {
    return <div className="alert alert-error">{error?.message}</div>;
  }
  if (!data || !ready) {
    return <LoadingOverlay />;
  }

  const status = getQueryStatus(data.experiments.queries || []);
  const experiments = data?.experiments?.experiments || [];

  experiments.sort((a, b) => {
    if (a.startDate < b.startDate) return 1;
    else if (a.startDate > b.startDate) return -1;
    return 0;
  });

  return (
    <div className="container-fluid pagecontents p-3">
      {create && (
        <NewExperimentForm
          onClose={() => setCreate(null)}
          initialValue={create}
          onCreate={(id) => {
            router.push(`/experiment/${id}#results`);
          }}
          isImport={true}
          source="import"
        />
      )}
      <h2>Import Experiments</h2>
      <p>
        From datasource:{" "}
        <strong>{getById(data.experiments.datasource).name}</strong>
      </p>
      <div className="row mb-3">
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
              mutate();
            }}
          >
            <RunQueriesButton
              cta="Refresh List"
              initialStatus={getQueryStatus(data.experiments.queries || [])}
              statusEndpoint={`/experiments/import/${data.experiments.id}/status`}
              cancelEndpoint={`/experiments/import/${data.experiments.id}/cancel`}
              onReady={() => {
                mutate();
              }}
            />
          </form>
        </div>
        <div className="col-auto">
          <ViewAsyncQueriesButton
            queries={
              data.experiments.queries?.length > 0
                ? data.experiments.queries.map((q) => q.query)
                : []
            }
          />
        </div>
      </div>
      {status === "failed" && (
        <div className="alert alert-danger my-3">
          Error importing experiments. View Queries for more info
        </div>
      )}
      {experiments.length > 0 && (
        <div>
          <h3>Available Experiments</h3>
          <p>
            These are all of the experiments we found in your datasource for the
            past 12 months.
          </p>
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
              {experiments.map((e) => (
                <tr key={e.trackingKey}>
                  <td>{e.trackingKey}</td>
                  <td>{date(e.startDate)}</td>
                  <td>{date(e.endDate)}</td>
                  <td>{e.numVariations}</td>
                  <td>{numberFormatter.format(e.users)}</td>
                  <td>{e.weights.map((w) => Math.round(w * 100)).join("/")}</td>
                  <td>
                    {data.existing?.[e.trackingKey] ? (
                      <Link
                        href={`/experiment/${data.existing?.[e.trackingKey]}`}
                      >
                        <a>imported</a>
                      </Link>
                    ) : (
                      <Button
                        color="primary"
                        onClick={async () => {
                          setCreate({
                            name: e.trackingKey,
                            trackingKey: e.trackingKey,
                            datasource: data.experiments.datasource,
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
                                  new Date(e.startDate)
                                    .toISOString()
                                    .substr(0, 10) + "T00:00:00Z",
                                dateEnded:
                                  new Date(e.endDate)
                                    .toISOString()
                                    .substr(0, 10) + "T23:59:59Z",
                              },
                            ],
                          });
                        }}
                      >
                        Import
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
export default ImportPage;
