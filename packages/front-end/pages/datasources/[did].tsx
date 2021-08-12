import Link from "next/link";
import { useRouter } from "next/router";
import { FC, useState } from "react";
import { FaAngleLeft, FaCloudDownloadAlt, FaCode, FaKey } from "react-icons/fa";
import DeleteButton from "../../components/DeleteButton";
import Button from "../../components/Button";
import { useAuth } from "../../services/auth";
import { useDefinitions } from "../../services/DefinitionsContext";
import DataSourceForm from "../../components/Settings/DataSourceForm";
import EditDataSourceSettingsForm from "../../components/Settings/EditDataSourceSettingsForm";
import LoadingOverlay from "../../components/LoadingOverlay";
import Code from "../../components/Code";
import {
  getExperimentQuery,
  getPageviewsQuery,
  getUsersQuery,
} from "../../services/datasources";
import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
import { hasFileConfig } from "../../services/env";

const DataSourcePage: FC = () => {
  const [editConn, setEditConn] = useState(false);
  const [editSettings, setEditSettings] = useState(false);

  const canEdit = !hasFileConfig();

  const router = useRouter();

  const {
    getDatasourceById,
    mutateDefinitions,
    ready,
    error,
  } = useDefinitions();
  const { did } = router.query as { did: string };

  const d = getDatasourceById(did);

  const { apiCall } = useAuth();

  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }
  if (!ready) {
    return <LoadingOverlay />;
  }
  if (!d) {
    return (
      <div className="alert alert-danger">
        Datasource <code>{did}</code> does not exist.
      </div>
    );
  }

  const supportsSQL = !["google_analytics", "mixpanel"].includes(d.type);
  const supportsEvents = d.type === "mixpanel";

  return (
    <div className="container mt-3 pagecontents">
      <div className="mb-2">
        <Link href="/datasources">
          <a>
            <FaAngleLeft /> All Data Sources
          </a>
        </Link>
      </div>
      <div className="row mb-3 align-items-center">
        <div className="col-auto">
          <h1 className="mb-0">{d.name}</h1>
        </div>
        <div className="col-auto">
          <span className="badge badge-secondary">{d.type}</span>
        </div>
        <div style={{ flex: 1 }} />
        {canEdit && (
          <div className="col-auto">
            <DeleteButton
              displayName={d.name}
              text="Delete"
              onClick={async () => {
                await apiCall(`/datasource/${d.id}`, {
                  method: "DELETE",
                });
                mutateDefinitions({});
                router.push("/datasources");
              }}
            />
          </div>
        )}
      </div>

      <div className="row">
        <div className="col-md-9">
          <div className="row mb-3">
            {canEdit && (
              <div className="col-auto">
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setEditConn(true);
                  }}
                >
                  <FaKey /> Edit Connection Info
                </a>
              </div>
            )}
            {(supportsSQL || supportsEvents) && canEdit && (
              <div className="col-auto">
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setEditSettings(true);
                  }}
                >
                  <FaCode /> Edit {supportsSQL ? "Queries" : "Query Settings"}
                </a>
              </div>
            )}
          </div>
          {d.type === "google_analytics" && (
            <div className="alert alert-info">
              Google Analytics data sources do not require any additional
              configuration.
            </div>
          )}
          {supportsEvents && (
            <>
              <h3 className="mb-3">Query Settings</h3>
              <table className="table table-bordered">
                <tbody>
                  {Object.keys(d.settings.events).map((k) => {
                    return (
                      <tr key={k}>
                        <th>
                          {k[0].toUpperCase() +
                            k.replace(/([A-Z])/g, " $1").slice(1)}
                        </th>
                        <td>
                          <code>{d.settings.events[k]}</code>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <ul></ul>
            </>
          )}
          {supportsSQL && (
            <>
              <div className="mb-4">
                <h3>Experiments SQL</h3>
                <div>Used to pull experiment results.</div>
                <Code
                  language="sql"
                  code={getExperimentQuery(
                    d.settings,
                    (d.params as PostgresConnectionParams)?.defaultSchema
                  )}
                />
              </div>
              <div className="mb-4">
                <h3>Users Query</h3>
                <div>
                  Used to join users to anonymous sessions before they logged
                  in.
                </div>
                <Code
                  language="sql"
                  code={getUsersQuery(
                    d.settings,
                    (d.params as PostgresConnectionParams)?.defaultSchema
                  )}
                />
              </div>
              <div className="mb-4">
                <h3>Pageviews Query</h3>
                <div>
                  Used to predict running time before an experiment starts.
                </div>
                <Code
                  language="sql"
                  code={getPageviewsQuery(
                    d.settings,
                    (d.params as PostgresConnectionParams)?.defaultSchema
                  )}
                />
              </div>
            </>
          )}
        </div>
        <div className="col-md-3">
          {supportsSQL && (
            <div className="card">
              <div className="card-body">
                <h2>Import Past Experiments</h2>
                <p>
                  If you have past experiments already in your data source, you
                  can import them to Growth Book.
                </p>
                <Button
                  color="outline-primary"
                  onClick={async () => {
                    const res = await apiCall<{ id: string }>(
                      "/experiments/import",
                      {
                        method: "POST",
                        body: JSON.stringify({
                          datasource: d.id,
                        }),
                      }
                    );
                    if (res.id) {
                      await router.push(`/experiments/import/${res.id}`);
                    }
                  }}
                >
                  <FaCloudDownloadAlt /> Import
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {editConn && (
        <DataSourceForm
          existing={true}
          data={d}
          source={"datasource-detail"}
          onSuccess={() => {
            mutateDefinitions({});
          }}
          onCancel={() => {
            setEditConn(false);
          }}
        />
      )}

      {editSettings && (
        <EditDataSourceSettingsForm
          data={d}
          source={"datasource-detail"}
          onSuccess={() => {
            mutateDefinitions({});
          }}
          onCancel={() => {
            setEditSettings(false);
          }}
        />
      )}
    </div>
  );
};
export default DataSourcePage;
