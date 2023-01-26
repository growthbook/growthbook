import React, { FC, Fragment, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { SegmentInterface } from "back-end/types/segment";
import { IdeaInterface } from "back-end/types/idea";
import { MetricInterface } from "back-end/types/metric";
import Link from "next/link";
import LoadingOverlay from "@/components/LoadingOverlay";
import { ago } from "@/services/dates";
import Button from "@/components/Button";
import SegmentForm from "@/components/Segments/SegmentForm";
import { useDefinitions } from "@/services/DefinitionsContext";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import { GBAddCircle } from "@/components/Icons";
import usePermissions from "@/hooks/usePermissions";
import Code, { Language } from "@/components/SyntaxHighlighting/Code";

const SegmentPage: FC = () => {
  const {
    segments,
    ready,
    getDatasourceById,
    datasources,
    error: segmentsError,
    mutateDefinitions: mutate,
  } = useDefinitions();

  const permissions = usePermissions();

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
          experiments?: { id: string; name: string }[];
          total?: number;
        }>(`/segments/${s.id}/usage`, {
          method: "GET",
        });

        const metricLinks = [];
        const ideaLinks = [];
        const expLinks = [];
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
          if (res.experiments.length) {
            refs.push(
              res.experiments.length === 1
                ? "1 experiment"
                : res.experiments.length + " Experiments"
            );
            res.experiments.forEach((e) => {
              expLinks.push(
                <Link href={`/experiment/${e.id}`}>
                  <a>{e.name}</a>
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
                    {expLinks.length > 0 && (
                      <div className="col-6 text-smaller text-left">
                        Experiments:{" "}
                        <ul className="mb-0 pl-3">
                          {expLinks.map((l, i) => {
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
    (d) => d.properties?.segments
  )[0];

  if (!hasValidDataSources) {
    return (
      <div className="p-3 container-fluid pagecontents">
        <div className="row mb-3">
          <div className="col d-flex">
            <h1>Segments</h1>
          </div>
        </div>
        <div className="alert alert-info">
          Segments are only available if you connect GrowthBook to a compatible
          data source (Snowflake, Redshift, BigQuery, ClickHouse, Athena,
          Postgres, MySQL, MS SQL, Presto, Databricks, or Mixpanel). Support for
          other data sources like Google Analytics is coming soon.
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
        <div className="col-auto d-flex">
          <h1>Segments</h1>
        </div>
        <div style={{ flex: 1 }}></div>
        {permissions.createSegments && (
          <div className="col-auto">
            <Button
              color="primary"
              onClick={async () => {
                setSegmentForm({});
              }}
            >
              <span className="h4 pr-2 m-0 d-inline-block align-top">
                <GBAddCircle />
              </span>{" "}
              New Segment
            </Button>
          </div>
        )}
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
            <table className="table appbox gbtable table-hover">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Owner</th>
                  <th className="d-none d-sm-table-cell">Data Source</th>
                  <th className="d-none d-md-table-cell">Identifier Type</th>
                  <th className="d-none d-lg-table-cell">Definition</th>
                  <th>Date Updated</th>
                  {permissions.createSegments && <th></th>}
                </tr>
              </thead>
              <tbody>
                {segments.map((s) => {
                  const datasource = getDatasourceById(s.datasource);
                  const language: Language =
                    datasource?.properties?.queryLanguage || "sql";
                  return (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{s.owner}</td>
                      <td className="d-none d-sm-table-cell">
                        {datasource && (
                          <>
                            <div>
                              <Link href={`/datasources/${datasource?.id}`}>
                                {datasource?.name}
                              </Link>
                            </div>
                            <div
                              className="text-gray font-weight-normal small text-ellipsis"
                              style={{ maxWidth: 350 }}
                            >
                              {datasource?.description}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="d-none d-md-table-cell">
                        {datasource?.properties?.userIds
                          ? s.userIdType || "user_id"
                          : ""}
                      </td>
                      <td
                        className="d-none d-lg-table-cell"
                        style={{ maxWidth: "30em" }}
                      >
                        <Code
                          code={s.sql}
                          language={language}
                          expandable={true}
                        />
                      </td>
                      <td>{ago(s.dateUpdated)}</td>
                      {permissions.createSegments && (
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
                              await apiCall<{
                                status: number;
                                message?: string;
                              }>(`/segments/${s.id}`, {
                                method: "DELETE",
                                body: JSON.stringify({ id: s.id }),
                              });
                              await mutate({});
                            }}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {segments.length === 0 && (
        <div className="alert alert-info">
          You don&apos;t have any segments defined yet.{" "}
          {permissions.createSegments &&
            "Click the button above to create your first one."}
        </div>
      )}
    </div>
  );
};

export default SegmentPage;
