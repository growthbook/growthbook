import { FC, useState } from "react";
import { FaPlus, FaPencilAlt } from "react-icons/fa";
import LoadingOverlay from "../../components/LoadingOverlay";
import { SegmentInterface } from "back-end/types/segment";
import { ago } from "../../services/dates";
import Button from "../../components/Button";
import SegmentForm from "../../components/Segments/SegmentForm";
import { useDefinitions } from "../../services/DefinitionsContext";

const SegmentPage: FC = () => {
  const {
    segments,
    ready,
    getDatasourceById,
    datasources,
    error: segmentsError,
  } = useDefinitions();

  const [
    segmentForm,
    setSegmentForm,
  ] = useState<null | Partial<SegmentInterface>>(null);

  if (!segmentsError && !ready) {
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
            <h3>Segments</h3>
          </div>
        </div>
        <div className="alert alert-info">
          Segments are only available if you connect Growth Book to a compatible
          data source (Snowflake, Redshift, BigQuery, ClickHouse, Athena,
          Postgres, Presto, or Mixpanel). Support for other data sources like
          Google Analytics is coming soon.
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 container-fluid pagecontents">
      {segmentForm && (
        <SegmentForm close={() => setSegmentForm(null)} current={segmentForm} />
      )}
      <div className="row mb-3">
        <div className="col-auto">
          <h3>Segments</h3>
        </div>
        <div className="col-auto">
          <Button
            color="success"
            onClick={async () => {
              setSegmentForm({});
            }}
          >
            <FaPlus /> New Segment
          </Button>
        </div>
      </div>
      {segmentsError && (
        <div className="alert alert-danger">
          There was an error loading the list of segments
        </div>
      )}
      {segments.length > 0 && (
        <div className="row mb-4">
          <div className="col-auto">
            <p>
              Segments define important groups of users - for example,
              &quot;annual subscribers&quot; or &quot;left-handed people from
              France.&quot;
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
                {segments.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="d-none d-sm-table-cell">
                      {getDatasourceById(s.datasource)?.name}
                    </td>
                    <td className="d-none d-lg-table-cell">
                      <code>{s.sql}</code>
                    </td>
                    <td>{ago(s.dateUpdated)}</td>
                    <td>
                      <a
                        href="#"
                        className="tr-hover text-primary"
                        onClick={(e) => {
                          e.preventDefault();
                          setSegmentForm(s);
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
      {segments.length === 0 && (
        <div className="alert alert-info">
          You don&apos;t have any segments defined yet. Click the green button
          above to create your first one.
        </div>
      )}
    </div>
  );
};

export default SegmentPage;
