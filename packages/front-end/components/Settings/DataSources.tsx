import { FC, useState } from "react";
import LoadingOverlay from "../LoadingOverlay";
import { FaPlus, FaPencilAlt, FaCloudDownloadAlt } from "react-icons/fa";
import DataSourceForm from "./DataSourceForm";
import useDatasources from "../../hooks/useDatasources";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import DeleteButton from "../DeleteButton";
import Button from "../Button";
import { useRouter } from "next/router";
import { useAuth } from "../../services/auth";

const DEFAULT_DATA_SOURCE: Partial<DataSourceInterfaceWithParams> = {
  type: "redshift",
  name: "My Datasource",
  params: {
    port: 5439,
    database: "",
    host: "",
    password: "",
    user: "",
    defaultSchema: "",
  },
  settings: {
    default: {
      timestampColumn: "received_at",
      userIdColumn: "user_id",
    },
    experiments: {
      experimentIdColumn: "experiment_id",
      table: "experiment_viewed",
      variationColumn: "variation_id",
      variationFormat: "index",
    },
    users: {
      table: "users",
    },
    pageviews: {
      table: "pages",
      urlColumn: "path",
    },
  },
};

const DataSources: FC = () => {
  const [edit, setEdit] = useState<Partial<DataSourceInterfaceWithParams>>(
    null
  );

  const router = useRouter();

  const { apiCall } = useAuth();

  const { datasources, error, refresh, ready } = useDatasources();

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!ready) {
    return <LoadingOverlay />;
  }

  return (
    <div>
      {datasources.length > 0 ? (
        <table className="table appbox table-hover">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {datasources.map((d, i) => (
              <tr className="nav-item" key={i}>
                <td>{d.name}</td>
                <td>{d.type}</td>
                <td>
                  <button
                    className="btn btn-outline-primary"
                    onClick={(e) => {
                      e.preventDefault();
                      setEdit(d);
                    }}
                  >
                    <FaPencilAlt /> Edit
                  </button>{" "}
                  <DeleteButton
                    displayName={d.name}
                    text="Delete"
                    onClick={async () => {
                      await apiCall(`/datasource/${d.id}`, {
                        method: "DELETE",
                      });
                      refresh();
                    }}
                  />{" "}
                  {!["google_analytics", "mixpanel"].includes(d.type) &&
                    d?.settings?.experiments?.table && (
                      <Button
                        color="outline-secondary"
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
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div>
          <p>
            Connect Growth Book to your data so we can automatically fetch
            experiment results and metric values. We currently support{" "}
            <strong>Redshift</strong>, <strong>Snowflake</strong>,{" "}
            <strong>BigQuery</strong>, <strong>Postgres</strong>,{" "}
            <strong>Athena</strong>, <strong>Mixpanel</strong>, and{" "}
            <strong>Google Analytics</strong> with more coming soon.
          </p>
          <p>
            We only ever fetch aggregate data, so none of your user&apos;s
            Personally Identifiable Information ever hits our servers. Plus, we
            use multiple layers of encryption to store your credentials and
            require minimal read-only permissions, so you can be sure your
            source data remains secure.
          </p>
        </div>
      )}

      <button
        className="btn btn-success"
        onClick={(e) => {
          e.preventDefault();
          setEdit(DEFAULT_DATA_SOURCE);
        }}
      >
        <FaPlus /> Add Data Source
      </button>
      {edit && (
        <DataSourceForm
          existing={edit !== DEFAULT_DATA_SOURCE}
          data={edit}
          onSuccess={() => {
            refresh();
          }}
          onCancel={() => {
            setEdit(null);
          }}
        />
      )}
    </div>
  );
};

export default DataSources;
