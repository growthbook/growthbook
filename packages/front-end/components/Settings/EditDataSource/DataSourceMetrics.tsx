import { useState } from "react";
import { FaArchive, FaChevronRight, FaPlus } from "react-icons/fa";
import Link from "next/link";
import { ago, datetime } from "shared/dates";
import clsx from "clsx";
import { getMetricLink } from "shared/experiments";
import { DocLink } from "@/components/DocLink";
import { envAllowsCreatingMetrics } from "@/services/env";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import AutoGenerateMetricsButton from "@/components/AutoGenerateMetricsButton";
import AutoGenerateMetricsModal from "@/components/AutoGenerateMetricsModal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import {
  MetricModal,
  MetricModalState,
} from "@/components/FactTables/NewMetricModal";
import { useCombinedMetrics } from "@/components/Metrics/MetricsList";
import { DataSourceQueryEditingModalBaseProps } from "./types";

type DataSourceMetricsProps = Omit<
  DataSourceQueryEditingModalBaseProps,
  "onSave" | "onCancel"
>;

export default function DataSourceMetrics({
  dataSource,
  canEdit,
}: DataSourceMetricsProps) {
  const permissionsUtil = usePermissionsUtil();
  const [
    showAutoGenerateMetricsModal,
    setShowAutoGenerateMetricsModal,
  ] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [modalData, setModalData] = useState<MetricModalState | null>(null);
  const { mutateDefinitions } = useDefinitions();

  const combinedMetrics = useCombinedMetrics({
    setMetricModalProps: setModalData,
  });
  const metrics = combinedMetrics.filter((m) => m.datasource === dataSource.id);

  // Auto-generated metrics inherit the data source's projects, so check that the user has createMetric permission for all of them
  const canCreateMetricsInAllDataSourceProjects = permissionsUtil.canCreateMetric(
    { projects: dataSource.projects }
  );

  return (
    <>
      {showAutoGenerateMetricsModal && (
        <AutoGenerateMetricsModal
          source="datasource-detail-page"
          datasource={dataSource}
          setShowAutoGenerateMetricsModal={setShowAutoGenerateMetricsModal}
          mutate={mutateDefinitions}
        />
      )}
      {modalData ? (
        <MetricModal
          {...modalData}
          close={() => setModalData(null)}
          source="datasource-detail"
          datasource={dataSource.id}
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
          {canEdit &&
          envAllowsCreatingMetrics() &&
          canCreateMetricsInAllDataSourceProjects ? (
            <>
              <AutoGenerateMetricsButton
                setShowAutoGenerateMetricsModal={
                  setShowAutoGenerateMetricsModal
                }
                datasource={dataSource}
                size="sm"
              />
              <button
                className="btn btn-outline-primary font-weight-bold text-nowrap"
                onClick={() => setModalData({ mode: "new" })}
              >
                <FaPlus className="mr-1" /> Add
              </button>
            </>
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
                    <div className="d-flex flex-row align-items-center justify-content-between">
                      <div className="pr-3">
                        <div className="mr-5 w-100">
                          <h4 className={metric.archived ? "text-muted" : ""}>
                            <Link href={getMetricLink(metric.id)}>
                              {metric.name}
                            </Link>
                          </h4>
                          <div className="d-flex flex-row align-items-center">
                            <div className="pr-3">
                              <strong
                                className={metric.archived ? "text-muted" : ""}
                              >
                                Type:{" "}
                              </strong>
                              <code
                                className={metric.archived ? "text-muted" : ""}
                              >
                                {metric.type}
                              </code>
                            </div>
                            <div
                              className={clsx(
                                {
                                  "text-muted": metric.archived,
                                },
                                "pr-3"
                              )}
                            >
                              <strong>Owner: </strong>
                              {metric.owner}
                            </div>
                            <div
                              className={clsx(
                                {
                                  "text-muted": metric.archived,
                                },
                                "pr-3"
                              )}
                            >
                              <strong>Projects: </strong>
                              {!metric?.projects?.length ? (
                                <ProjectBadges
                                  resourceType="metric"
                                  className="badge-ellipsis align-middle"
                                />
                              ) : (
                                <ProjectBadges
                                  resourceType="metric"
                                  projectIds={metric.projects}
                                  className={clsx(
                                    {
                                      "text-muted": metric.archived,
                                    },
                                    "badge-ellipsis align-middle"
                                  )}
                                />
                              )}
                            </div>
                            {metric.managedBy !== "config" && (
                              <div
                                title={datetime(metric.dateUpdated || "")}
                                className={clsx(
                                  {
                                    "text-muted": metric.archived,
                                  },
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
                          {metric.archived ? (
                            <Tooltip
                              body={"Archived"}
                              innerClassName="p-2"
                              tipMinWidth="auto"
                            >
                              <FaArchive />
                            </Tooltip>
                          ) : null}
                        </div>
                        <MoreMenu className="px-2">
                          {metric.onDuplicate ? (
                            <button
                              className="btn dropdown-item py-2"
                              onClick={(e) => {
                                e.preventDefault();
                                metric.onDuplicate?.();
                              }}
                            >
                              Duplicate
                            </button>
                          ) : null}
                          {!metric.managedBy &&
                          !metric.archived &&
                          metric.onEdit ? (
                            <button
                              className="btn dropdown-item py-2"
                              onClick={(e) => {
                                e.preventDefault();
                                metric.onEdit?.();
                              }}
                            >
                              Edit
                            </button>
                          ) : null}
                          {!metric.managedBy && metric.onArchive ? (
                            <button
                              className="btn dropdown-item py-2"
                              color=""
                              onClick={async () => {
                                await metric.onArchive?.(!metric.archived);
                              }}
                            >
                              {metric.archived ? "Unarchive" : "Archive"}
                            </button>
                          ) : null}
                        </MoreMenu>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="alert alert-info">
              No metrics have been defined yet from this data source. Click the{" "}
              <strong>Add</strong> button to create your first one.
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
