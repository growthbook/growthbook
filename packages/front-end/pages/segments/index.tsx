import { FC, useState } from "react";
import { FaPlus, FaPencilAlt } from "react-icons/fa";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import { SegmentInterface } from "back-end/types/segment";
import Link from "next/link";
import { ago } from "../../services/dates";
import Button from "../../components/Button";
import { useAuth } from "../../services/auth";
import { useRouter } from "next/router";
import SegmentForm from "../../components/Segments/SegmentForm";
import { SegmentComparisonInterface } from "back-end/types/segment-comparison";
import { useDefinitions } from "../../services/DefinitionsContext";

const SegmentPage: FC = () => {
  const { data, error } = useApi<{
    comparisons: SegmentComparisonInterface[];
  }>("/segments/comparisons");

  const {
    segments,
    getSegmentById,
    ready,
    getDatasourceById,
    datasources,
    getMetricById,
    error: segmentsError,
  } = useDefinitions();

  const [
    segmentForm,
    setSegmentForm,
  ] = useState<null | Partial<SegmentInterface>>(null);

  const { apiCall } = useAuth();
  const router = useRouter();

  if (!error && !segmentsError && (!data || !ready)) {
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
          data source (Snowflake, Redshift, BigQuery, Athena, Postgres, or
          Mixpanel). Support for other data sources like Google Analytics is
          coming soon.
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
              France.&quot; In Growth Book, you can compare segments against
              each other or use them to target experiments to subsets of users.
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
      {segments.length > 0 && (
        <>
          <hr />
          <div className="row mb-3 pt-4">
            <div className="col-auto">
              <h3>Comparisons</h3>
            </div>
            <div className="col-auto">
              <Button
                color="success"
                onClick={async () => {
                  const res = await apiCall<{ id: string }>(
                    `/segments/comparisons`,
                    {
                      method: "POST",
                    }
                  );
                  await router.push(`/segments/comparison/${res.id}`);
                }}
              >
                <FaPlus /> New Comparison
              </Button>
            </div>
          </div>
          {error && (
            <div className="alert alert-danger">
              There was an error loading the list of segment comparisons
            </div>
          )}
          {data.comparisons.length > 0 && (
            <div className="row">
              <div className="col-auto">
                <table className="table table-hover appbox">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th className="d-none d-lg-table-cell">Datasource</th>
                      <th className="d-none d-sm-table-cell">Segment 1</th>
                      <th className="d-none d-sm-table-cell">Segment 2</th>
                      <th className="d-none d-md-table-cell">Metrics</th>
                      <th>Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.comparisons.map((a) => (
                      <tr
                        key={a.id}
                        onClick={(e) => {
                          e.preventDefault();
                          router.push(`/segments/comparison/${a.id}`);
                        }}
                      >
                        <td>
                          <Link href={`/segments/comparison/${a.id}`}>
                            <a>{a.title}</a>
                          </Link>
                        </td>
                        <td className="d-none d-lg-table-cell">
                          {getDatasourceById(a.datasource)?.name || ""}
                        </td>
                        <td className="d-none d-sm-table-cell">
                          {getSegmentById(a.segment1.segment)?.name}
                        </td>
                        <td className="d-none d-sm-table-cell">
                          {getSegmentById(a.segment2.segment)?.name}
                        </td>
                        <td className="d-none d-md-table-cell">
                          {a.metrics.map((m) => (
                            <div className="badge badge-secondary mr-1" key={m}>
                              {getMetricById(m)?.name || m}
                            </div>
                          ))}
                        </td>
                        <td>{ago(a.dateUpdated)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {data && data.comparisons.length === 0 && (
            <div className="alert alert-info">
              You don&apos;t have any segment comparisons yet. Click the green
              button above to create your first one.
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SegmentPage;
