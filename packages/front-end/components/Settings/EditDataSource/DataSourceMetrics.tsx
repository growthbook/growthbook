import { MetricInterface } from "@/../back-end/types/metric";
import { useState } from "react";
import { FaArchive, FaChevronRight, FaPlus, FaRegCopy } from "react-icons/fa";
import Link from "next/link";
import { ago, datetime } from "@/../shared/dates";
import clsx from "clsx";
import { GlobalPermission } from "@/../back-end/types/organization";
import { DataSourceInterfaceWithParams } from "@/../back-end/types/datasource";
import { DocLink } from "@/components/DocLink";
import { hasFileConfig } from "@/services/env";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricForm from "@/components/Metrics/MetricForm";
import { checkMetricProjectPermissions } from "@/services/metrics";
import { PermissionFunctions } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";

type Props = {
  datasource: DataSourceInterfaceWithParams;
  permissions: Record<GlobalPermission, boolean> & PermissionFunctions;
};

export default function DataSourceMetrics({ datasource, permissions }: Props) {
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [modalData, setModalData] = useState<{
    current: Partial<MetricInterface>;
    edit: boolean;
    duplicate: boolean;
  } | null>(null);
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();

  const { data, mutate } = useApi<{
    metrics: MetricInterface[];
  }>(`/datasource/${datasource.id}/metrics`);

  const metrics: MetricInterface[] | undefined = data?.metrics;

  const filteredMetrics = metrics?.filter((m) => {
    if (!m.projects?.length) return true;

    if (!datasource?.projects?.length) return true;

    return m.projects?.some((p) => datasource.projects?.includes(p));
  });

  const editMetricsPermissions: { [id: string]: boolean } = {};
  filteredMetrics?.forEach((m) => {
    editMetricsPermissions[m.id] = checkMetricProjectPermissions(
      m,
      permissions
    );
  });

  console.log("editMetricsPermissions", editMetricsPermissions);

  const createMetricsPermissions = () => {
    let anyProjectsIncludeCreatePermissions = false;

    if (!datasource?.projects?.length) {
      return true;
    }

    datasource.projects.forEach((project) => {
      if (permissions.check("createMetrics", project)) {
        anyProjectsIncludeCreatePermissions = true;
      }
    });

    return anyProjectsIncludeCreatePermissions;
  };

  return (
    <>
      {modalData ? (
        <MetricForm
          {...modalData}
          onClose={() => setModalData(null)}
          onSuccess={() => {
            mutateDefinitions();
            mutate();
          }}
          source="datasource-detail"
        />
      ) : null}
      <div className="d-flex flex-row align-items-center justify-content-between">
        <div>
          <h2>
            Metrics{" "}
            <span className="badge badge-purple mx-2 my-0">
              {metrics && metrics.length > 0 ? metrics.length : "0"}
            </span>
          </h2>
          <p className="m-0">
            Metrics are what your experiments are trying to improve (or at least
            not hurt). Below are the metrics defined from this data source.{" "}
            <DocLink docSection="metrics">Learn more.</DocLink>
          </p>
        </div>
        <div className="d-flex flex-row pl-3">
          {createMetricsPermissions() && !hasFileConfig() ? (
            <button
              className="btn btn-outline-primary font-weight-bold text-nowrap"
              onClick={() =>
                setModalData({
                  current: { datasource: datasource.id },
                  edit: false,
                  duplicate: false,
                })
              }
            >
              <FaPlus className="mr-1" /> Add
            </button>
          ) : null}
          <button
            className="btn text-dark"
            onClick={(e) => {
              e.preventDefault();
              setMetricsOpen(!metricsOpen);
            }}
          >
            <FaChevronRight
              style={{
                transform: `rotate(${metricsOpen ? "90deg" : "0deg"})`,
              }}
            />
          </button>
        </div>
      </div>
      {metricsOpen ? (
        <div className="my-3">
          {metrics && metrics?.length > 0 ? (
            <div>
              {metrics.map((metric) => {
                return (
                  <div key={metric.id} className="card p-3 mb-3 bg-light">
                    <Link href={`/metric/${metric.id}`}>
                      <div
                        className="d-flex flex-row align-items-center justify-content-between"
                        role="button"
                      >
                        <div className="pr-3">
                          <div className="mr-5 w-100">
                            <h4
                              className={
                                metric.status === "archived" ? "text-muted" : ""
                              }
                            >
                              {metric.name}
                            </h4>
                            <div className="d-flex flex-row align-items-center">
                              <div className="pr-3">
                                <strong
                                  className={
                                    metric.status === "archived"
                                      ? "text-muted"
                                      : ""
                                  }
                                >
                                  Type:{" "}
                                </strong>
                                <code
                                  className={
                                    metric.status === "archived"
                                      ? "text-muted"
                                      : ""
                                  }
                                >
                                  {metric.type}
                                </code>
                              </div>
                              <div
                                className={clsx(
                                  metric.status === "archived"
                                    ? "text-muted"
                                    : "",
                                  "pr-3"
                                )}
                              >
                                <strong>Owner: </strong>
                                {metric.owner}
                              </div>
                              <div
                                className={clsx(
                                  metric.status === "archived"
                                    ? "text-muted"
                                    : "",
                                  "pr-3"
                                )}
                              >
                                <strong>Projects: </strong>
                                {!metric?.projects?.length ? (
                                  <ProjectBadges className="badge-ellipsis align-middle" />
                                ) : (
                                  <ProjectBadges
                                    projectIds={metric.projects}
                                    className="badge-ellipsis align-middle"
                                  />
                                )}
                              </div>
                              {!hasFileConfig() && (
                                <div
                                  title={datetime(metric.dateUpdated || "")}
                                  className={clsx(
                                    metric.status === "archived"
                                      ? "text-muted"
                                      : "",
                                    "d-none d-md-table-cell"
                                  )}
                                >
                                  <strong>Last Updated: </strong>
                                  {ago(metric.dateUpdated || "")}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="d-flex flex-row align-items-center">
                          <div className="text-muted px-2">
                            {metric.status === "archived" ? (
                              <Tooltip
                                body={"Archived"}
                                innerClassName="p-2"
                                tipMinWidth="auto"
                              >
                                <FaArchive />
                              </Tooltip>
                            ) : null}
                          </div>
                          {!hasFileConfig() &&
                          editMetricsPermissions[metric.id] ? (
                            <MoreMenu className="px-2">
                              <button
                                className="btn dropdown-item py-2"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  setModalData({
                                    current: {
                                      ...metric,
                                      name: metric.name + " (copy)",
                                    },
                                    edit: false,
                                    duplicate: true,
                                  });
                                }}
                              >
                                <FaRegCopy /> Duplicate
                              </button>
                              <button
                                className="btn dropdown-item py-2"
                                color=""
                                onClick={async () => {
                                  const newStatus =
                                    metric.status === "archived"
                                      ? "active"
                                      : "archived";
                                  await apiCall(`/metric/${metric.id}`, {
                                    method: "PUT",
                                    body: JSON.stringify({
                                      status: newStatus,
                                    }),
                                  });
                                  mutateDefinitions({});
                                  mutate();
                                }}
                              >
                                <FaArchive />{" "}
                                {metric.status === "archived"
                                  ? "Unarchive"
                                  : "Archive"}
                              </button>
                            </MoreMenu>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="alert alert-info">
              No metrics have been defined from this data source. Click the{" "}
              <strong>Add</strong> button to create your first.
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
