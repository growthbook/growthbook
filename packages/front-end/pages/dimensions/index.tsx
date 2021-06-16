import { FC, useState } from "react";
import { FaPlus, FaPencilAlt } from "react-icons/fa";
import LoadingOverlay from "../../components/LoadingOverlay";
import { ago } from "../../services/dates";
import Button from "../../components/Button";
import { DimensionInterface } from "back-end/types/dimension";
import DimensionForm from "../../components/Dimensions/DimensionForm";
import { useDefinitions } from "../../services/DefinitionsContext";

const DimensionsPage: FC = () => {
  const {
    dimensions,
    datasources,
    getDatasourceById,
    ready,
    error,
  } = useDefinitions();

  const [
    dimensionForm,
    setDimensionForm,
  ] = useState<null | Partial<DimensionInterface>>(null);

  if (!error && !ready) {
    return <LoadingOverlay />;
  }

  const hasValidDataSources = !!datasources.filter(
    (d) => d.type !== "google_analytics"
  )[0];

  if (!hasValidDataSources) {
    return (
      <div className="p-3 container-fluid pagecontents">
        <div className="row mb-3">
          <div className="col">
            <h3>Dimensions</h3>
          </div>
        </div>
        <div className="alert alert-info">
          Dimensions are only available if you connect Growth Book to a
          compatible data source (Snowflake, Redshift, BigQuery, ClickHouse,
          Athena, Postgres, or Mixpanel). Support for other data sources like
          Google Analytics is coming soon.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-danger">
        There was an error loading the list of dimensions
      </div>
    );
  }

  return (
    <div className="p-3 container-fluid pagecontents">
      {dimensionForm && (
        <DimensionForm
          close={() => setDimensionForm(null)}
          current={dimensionForm}
        />
      )}
      <div className="row mb-3">
        <div className="col-auto">
          <h3>Dimensions</h3>
        </div>
        <div className="col-auto">
          <Button
            color="success"
            onClick={async () => {
              setDimensionForm({});
            }}
          >
            <FaPlus /> New Dimension
          </Button>
        </div>
      </div>
      {dimensions.length > 0 && (
        <div className="row mb-4">
          <div className="col-auto">
            <p>
              Dimensions are user attributes - for example, &quot;subscription
              plan&quot; or &quot;browser.&quot; In Growth Book, you can use
              dimensions to drill down into experiment results and other
              reports.
            </p>
            <table className="table appbox table-hover">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="d-none d-sm-table-cell">Data Source</th>
                  <th className="d-none d-lg-table-cell">Definition</th>
                  <th>Date Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {dimensions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="d-none d-sm-table-cell">
                      {getDatasourceById(s.datasource)?.name}
                    </td>
                    <td className="d-none d-lg-table-cell">
                      {getDatasourceById(s.datasource)?.type === "mixpanel" ? (
                        <div>
                          Event property: <code>{s.sql}</code>
                        </div>
                      ) : (
                        <code>{s.sql}</code>
                      )}
                    </td>
                    <td>{ago(s.dateUpdated)}</td>
                    <td>
                      <a
                        href="#"
                        className="tr-hover text-primary"
                        onClick={(e) => {
                          e.preventDefault();
                          setDimensionForm(s);
                        }}
                      >
                        <FaPencilAlt />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!error && dimensions.length === 0 && (
        <div className="alert alert-info">
          You don&apos;t have any dimensions defined yet. Click the green button
          above to create your first one.
        </div>
      )}
    </div>
  );
};

export default DimensionsPage;
