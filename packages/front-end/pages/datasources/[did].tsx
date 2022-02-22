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
import { getExperimentQuery } from "../../services/datasources";
import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
import { hasFileConfig } from "../../services/env";

function quotePropertyName(name: string) {
  if (name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
    return name;
  }
  return JSON.stringify(name);
}

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
  const supportsImports = d.properties?.pastExperiments;

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
          <span className="badge badge-secondary">{d.type}</span>{" "}
          <span className="badge badge-success">connected</span>
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
              <table className="table appbox gbtable mb-5">
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
              {d.type === "mixpanel" && (
                <div>
                  <h3>Mixpanel Tracking Instructions</h3>
                  <p>
                    This example is for Javascript and uses the above settings.
                    Other languages should be similar.
                  </p>
                  <Code
                    language="javascript"
                    code={`
// Tracking Callback for GrowthBook SDK
const growthbook = new GrowthBook({
  ...,
  trackingCallback: function(experiment, result) {
    mixpanel.track(${JSON.stringify(d.settings.events.experimentEvent)}, {
      ${quotePropertyName(
        d.settings.events.experimentIdProperty
      )}: experiment.key,
      ${quotePropertyName(
        d.settings.events.variationIdProperty
      )}:  result.variationId
    })
  }
})

// When Mixpanel loads, pass the distinct_id into the SDK
mixpanel.init('YOUR PROJECT TOKEN', {
  loaded: function(mixpanel) {
    growthbook.setAttributes({
      ...growthbook.getAttributes(),
      id: mixpanel.get_distinct_id()
    })
  }
})
                  `.trim()}
                  />
                </div>
              )}
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
                {d.settings?.experimentDimensions?.length > 0 && (
                  <div className="mt-2">
                    <div>
                      <strong>Dimension Columns:</strong>{" "}
                      {d.settings.experimentDimensions.map((d) => (
                        <code key={d} className="mx-2">
                          {d}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
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
                    "import pandas as pd\n\ndef runQuery(sql):\n  # TODO: implement\n  return pd.DataFrame(...)"
                  }
                  language="python"
                />
              </div>
            </>
          )}
        </div>
        <div className="col-md-3">
          {supportsImports && (
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
