import React, { FC, Fragment, ReactElement, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { SegmentInterface } from "shared/types/segment";
import { IdeaInterface } from "shared/types/idea";
import { MetricInterface } from "shared/types/metric";
import Link from "next/link";
import clsx from "clsx";
import { ago } from "shared/dates";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import SegmentForm from "@/components/Segments/SegmentForm";
import { useDefinitions } from "@/services/DefinitionsContext";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import { hasFileConfig, storeSegmentsInMongo } from "@/services/env";
import { DocLink } from "@/components/DocLink";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import ProjectBadges from "@/components/ProjectBadges";
import { OfficialBadge } from "@/components/Metrics/MetricName";

const SegmentPage: FC = () => {
  const {
    segments,
    ready,
    getDatasourceById,
    datasources,
    error: segmentsError,
    mutateDefinitions: mutate,
    project,
  } = useDefinitions();

  const permissionsUtil = usePermissionsUtil();

  const hasCreatePermission = permissionsUtil.canCreateSegment({
    projects: [project],
  });
  let canStoreSegmentsInMongo = false;

  if (!hasFileConfig() || (hasFileConfig() && storeSegmentsInMongo())) {
    canStoreSegmentsInMongo = true;
  }

  const [segmentForm, setSegmentForm] =
    useState<null | Partial<SegmentInterface>>(null);

  const { apiCall } = useAuth();

  if (!segmentsError && !ready) {
    return <LoadingOverlay />;
  }

  const getSegmentUsage = (s: SegmentInterface) => {
    return async (): Promise<ReactElement | null> => {
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

        const metricLinks: (ReactElement | string)[] = [];
        const ideaLinks: (ReactElement | string)[] = [];
        const expLinks: (ReactElement | string)[] = [];
        let subtitleText = "This segment is not referenced anywhere else.";
        if (res.total) {
          subtitleText = "This segment is referenced in ";
          const refs: (ReactElement | string)[] = [];
          if (res.metrics && res.metrics.length) {
            refs.push(
              res.metrics.length === 1
                ? "1 metric"
                : res.metrics.length + " metrics",
            );
            res.metrics.forEach((m) => {
              metricLinks.push(
                <Link href={`/metric/${m.id}`} className="">
                  {m.name}
                </Link>,
              );
            });
          }
          if (res.ideas && res.ideas.length) {
            refs.push(
              res.ideas.length === 1 ? "1 idea" : res.ideas.length + " ideas",
            );
            res.ideas.forEach((i) => {
              ideaLinks.push(<Link href={`/idea/${i.id}`}>{i.text}</Link>);
            });
          }
          if (res.experiments && res.experiments.length) {
            refs.push(
              res.experiments.length === 1
                ? "1 experiment"
                : res.experiments.length + " Experiments",
            );
            res.experiments.forEach((e) => {
              expLinks.push(<Link href={`/experiment/${e.id}`}>{e.name}</Link>);
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
      return null;
    };
  };

  const hasValidDataSources = !!datasources.filter(
    (d) => d.properties?.segments,
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
        {hasCreatePermission && canStoreSegmentsInMongo && (
          <div className="col-auto">
            <Button
              onClick={() => {
                setSegmentForm({});
              }}
            >
              Add Segment
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
            <table
              className={clsx("table appbox gbtable", {
                "table-hover": !hasFileConfig(),
              })}
            >
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Owner</th>
                  <th>Projects</th>
                  <th className="d-none d-sm-table-cell">Data Source</th>
                  <th className="d-none d-md-table-cell">Identifier Type</th>
                  <th>Date Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {segments.map((s) => {
                  const datasource = getDatasourceById(s.datasource);
                  const userIdType = datasource?.properties?.userIds
                    ? s.userIdType || "user_id"
                    : "";
                  return (
                    <tr key={s.id}>
                      <td>
                        <>
                          <OfficialBadge
                            type="Segment"
                            managedBy={s.managedBy}
                          />
                          {s.name}{" "}
                          {s.description ? (
                            <Tooltip body={s.description} />
                          ) : null}
                        </>
                      </td>
                      <td>{s.owner}</td>
                      <td className="col-2">
                        {s && (s.projects || []).length > 0 ? (
                          <ProjectBadges
                            resourceType="segment"
                            projectIds={s.projects}
                          />
                        ) : (
                          <ProjectBadges resourceType="segment" />
                        )}
                      </td>
                      <td className="d-none d-sm-table-cell">
                        {datasource && (
                          <>
                            <Link href={`/datasources/${datasource.id}`}>
                              {datasource.name}
                            </Link>{" "}
                            {datasource.description ? (
                              <Tooltip body={datasource.description} />
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="d-none d-md-table-cell">
                        <span
                          className="badge badge-secondary mr-1"
                          key={`${s.id}-${userIdType}`}
                        >
                          {userIdType}
                        </span>
                      </td>
                      <td>
                        {s.managedBy !== "config" ? (
                          <>{ago(s.dateUpdated)}</>
                        ) : (
                          <>-</>
                        )}
                      </td>
                      <td>
                        <MoreMenu>
                          {/* If the user has permission & the segment isn't externally managed, show edit icon,
                          otherwise the cta should be `View Details`. This is because Segment's don't have an id page,
                         in order for the user to see the sql that powers the segment, we need to show the edit form, but in read only mode */}
                          <button
                            className="dropdown-item"
                            onClick={(e) => {
                              e.preventDefault();
                              setSegmentForm(s);
                            }}
                          >
                            {permissionsUtil.canUpdateSegment(s, {}) &&
                            !s.managedBy ? (
                              <>
                                <FaPencilAlt /> Edit
                              </>
                            ) : (
                              <>View Details</>
                            )}
                          </button>
                          {permissionsUtil.canDeleteSegment(s) &&
                          canStoreSegmentsInMongo &&
                          // if the segment has a managedBy value, it can't be deleted in the UI
                          !s.managedBy ? (
                            <DeleteButton
                              className="dropdown-item"
                              displayName={s.name}
                              text="Delete"
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
                          ) : null}
                        </MoreMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {segments.length === 0 && !hasFileConfig() && (
        <div className="alert alert-info">
          You don&apos;t have any segments defined yet.{" "}
          {hasCreatePermission &&
            "Click the button above to create your first one."}
        </div>
      )}
      {segments.length === 0 && hasFileConfig() && storeSegmentsInMongo() && (
        <div className="alert alert-info">
          You don&apos;t have any segments defined yet. You can add them to your{" "}
          <code>config.yml</code> file and remove the{" "}
          <code>STORE_SEGMENTS_IN_MONGO</code> environment variable
          {hasCreatePermission &&
            " or click the button above to create your first one"}
          . <DocLink docSection="config_yml">View Documentation</DocLink>
        </div>
      )}
      {segments.length === 0 && hasFileConfig() && !storeSegmentsInMongo() && (
        <div className="alert alert-info">
          It looks like you have a <code>config.yml</code> file. Segments
          defined there will show up on this page. If you would like to store
          and access segments in MongoDB instead, please add the{" "}
          <code>STORE_SEGMENTS_IN_MONGO</code> environment variable.{" "}
          <DocLink docSection="config_yml">View Documentation</DocLink>
        </div>
      )}
    </div>
  );
};

export default SegmentPage;
