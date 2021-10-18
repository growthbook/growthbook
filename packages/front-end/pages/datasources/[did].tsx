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

  const supportsSQL = d.properties?.queryLanguage === "sql";
  const supportsEvents = d.properties?.events || false;

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
                  <FaCode /> Edit Query Settings
                </a>
              </div>
            )}
          </div>
          {!d.properties?.hasSettings && (
            <div className="alert alert-info">
              This data source does not require any additional configuration.
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
            </>
          )}
          {supportsSQL && (
            <>
              <div className="mb-4">
                <h3>Experiments Query</h3>
                <div>
                  Returns variation assignment data for all experiments -{" "}
                  <em className="text-muted">
                    which users were in which experiments, what variation did
                    they see, and when?
                  </em>
                </div>
                <Code
                  language="sql"
                  code={getExperimentQuery(
                    d.settings,
                    (d.params as PostgresConnectionParams)?.defaultSchema
                  )}
                />
                <div className="mt-2">
                  <div>
                    <strong>Variation Id Format:</strong>{" "}
                    {d.settings?.variationIdFormat === "key" ? (
                      "String Keys"
                    ) : (
                      <>
                        Array Index (<code>0</code> = control, <code>1</code> =
                        1st variation, etc.)
                      </>
                    )}
                  </div>
                  {d.settings?.experimentDimensions?.length > 0 && (
                    <div>
                      <strong>Dimension Columns:</strong>{" "}
                      {d.settings.experimentDimensions.map((d) => (
                        <code key={d} className="mx-2">
                          {d}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="mb-4">
                <h3>Pageviews Query</h3>
                <div>
                  Returns all historical browsing activity on your website or
                  app -{" "}
                  <em className="text-muted">
                    which pages/screens did each user view and when
                  </em>
                </div>
                <div className="mt-2">
                  This is used to predict ahead of time how much traffic an
                  experiment will get and how long it will take to finish.
                </div>
                <Code
                  language="sql"
                  code={getPageviewsQuery(
                    d.settings,
                    (d.params as PostgresConnectionParams)?.defaultSchema
                  )}
                />
              </div>
              <div className="mb-4">
                <h3>Jupyter Notebook Query Runner</h3>
                <div>
                  Defines a Python <code>runQuery</code> function that executes
                  a SQL query and returns a pandas data frame.
                </div>
                <div className="mt-2">
                  Used to generate Jupyter Notebooks for experiments in this
                  data source.
                </div>
                <Code
                  code={
                    d.settings?.notebookRunQuery ||
                    "def runQuery(sql):\n  # TODO: implement\n  return pd.DataFrame(...)"
                  }
                  language="python"
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
                  can import them to GrowthBook.
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
          onSuccess={async () => {
            await mutateDefinitions({});
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
