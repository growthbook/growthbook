import React, { FC, Fragment, useState } from "react";
import { FaPlus, FaPencilAlt } from "react-icons/fa";
import LoadingOverlay from "../../components/LoadingOverlay";
import { SegmentInterface } from "back-end/types/segment";
import { ago } from "../../services/dates";
import Button from "../../components/Button";
import SegmentForm from "../../components/Segments/SegmentForm";
import { useDefinitions } from "../../services/DefinitionsContext";
import DeleteButton from "../../components/DeleteButton";
import { IdeaInterface } from "back-end/types/idea";
import { MetricInterface } from "back-end/types/metric";
import Link from "next/link";
import { useAuth } from "../../services/auth";

const SegmentPage: FC = () => {
  const {
    segments,
    ready,
    getDatasourceById,
    datasources,
    error: segmentsError,
    mutateDefinitions: mutate,
  } = useDefinitions();

  const [
    segmentForm,
    setSegmentForm,
  ] = useState<null | Partial<SegmentInterface>>(null);

  const { apiCall } = useAuth();

  if (!segmentsError && !ready) {
    return <LoadingOverlay />;
  }

  const getSegmentUsage = (s: SegmentInterface) => {
    return async () => {
      try {
        const res = await apiCall<{
          status: number;
          ideas?: IdeaInterface[];
          metrics?: MetricInterface[];
          total?: number;
        }>(`/segments/${s.id}/usage`, {
          method: "GET",
        });

        const metricLinks = [];
        const ideaLinks = [];
        let subtitleText = "This segment is not referenced anywhere else.";
        if (res.total) {
          subtitleText = "This segment is referenced in ";
          const refs = [];
          if (res.metrics.length) {
            refs.push(
              res.metrics.length === 1
                ? "1 metric"
                : res.metrics.length + " metrics"
            );
            res.metrics.forEach((m) => {
              metricLinks.push(
                <Link href={`/metric/${m.id}`}>
                  <a className="">{m.name}</a>
                </Link>
              );
            });
          }
          if (res.ideas.length) {
            refs.push(
              res.ideas.length === 1 ? "1 idea" : res.ideas.length + " ideas"
            );
            res.ideas.forEach((i) => {
              ideaLinks.push(
                <Link href={`/idea/${i.id}`}>
                  <a>{i.text}</a>
                </Link>
              );
            });
          }
          subtitleText += refs.join(" and ");

          return (
            <div>
              <p>{subtitleText}</p>
              {res.total > 0 && (
                <>
                  <div
                    className="row mx-2 mb-2 mt-1 py-2"
                    style={{ fontSize: "0.8rem", border: "1px solid #eee" }}
                  >
                    {metricLinks.length > 0 && (
                      <div className="col-6 text-smaller text-left">
                        Metrics:{" "}
                        <ul className="mb-0 pl-3">
                          {metricLinks.map((l, i) => {
                            return (
                              <Fragment key={i}>
                                <li className="">{l}</li>
                              </Fragment>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {ideaLinks.length > 0 && (
                      <div className="col-6 text-smaller text-left">
                        Ideas:{" "}
                        <ul className="mb-0 pl-3">
                          {ideaLinks.map((l, i) => {
                            return (
                              <Fragment key={i}>
                                <li className="">{l}</li>
                              </Fragment>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                  <p className="mb-0">
                    Deleting this segment will remove these references
                  </p>
                </>
              )}
              <p>This action cannot be undone.</p>
            </div>
          );
        }
      } catch (e) {
        console.error(e);
        return (
          <div className="alert alert-danger">
            An error occurred getting the segment usage
          </div>
        );
      }
    };
  };

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
          Segments are only available if you connect GrowthBook to a compatible
          data source (Snowflake, Redshift, BigQuery, ClickHouse, Athena,
          Postgres, MySQL, Presto, or Mixpanel). Support for other data sources
          like Google Analytics is coming soon.
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
          <div className="col-12">
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
                        className="tr-hover text-primary mr-3"
                        title="Edit this segment"
                        onClick={(e) => {
                          e.preventDefault();
                          setSegmentForm(s);
                        }}
                      >
                        <FaPencilAlt />
                      </a>
                      <DeleteButton
                        link={true}
                        className={"tr-hover text-primary"}
                        displayName={s.name}
                        title="Delete this segment"
                        getConfirmationContent={getSegmentUsage(s)}
                        onClick={async () => {
                          await apiCall<{ status: number; message?: string }>(
                            `/segments/${s.id}`,
                            {
                              method: "DELETE",
                              body: JSON.stringify({ id: s.id }),
                            }
                          );
                          await mutate({});
                        }}
                      />
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
