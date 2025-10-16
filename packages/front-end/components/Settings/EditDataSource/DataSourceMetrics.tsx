import React, { useState } from "react";
import { FaArchive, FaChevronRight, FaPlus } from "react-icons/fa";
import Link from "next/link";
import { ago, datetime } from "shared/dates";
import clsx from "clsx";
import { getMetricLink } from "shared/experiments";
import { Box, Card, Flex, Heading } from "@radix-ui/themes";
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
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import useOrgSettings from "@/hooks/useOrgSettings";
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
  const [showAutoGenerateMetricsModal, setShowAutoGenerateMetricsModal] =
    useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [modalData, setModalData] = useState<MetricModalState | null>(null);
  const settings = useOrgSettings();
  const { disableLegacyMetricCreation } = settings;
  const {
    mutateDefinitions,
    factTables,
    metrics: legacyMetrics,
  } = useDefinitions();

  const combinedMetrics = useCombinedMetrics({
    setMetricModalProps: setModalData,
  });
  const metrics = combinedMetrics.filter((m) => m.datasource === dataSource.id);

  const hasLegacyMetrics = legacyMetrics.some(
    (f) => f.datasource === dataSource.id,
  );

  const hasFactTables = factTables.some((f) => f.datasource === dataSource.id);

  // Show the create fact table button if there are no legacy metrics and no fact tables
  // If disableLegacyMetricCreation is true, show the create fact table button if there are no fact tables
  const showCreateFactTableButton = disableLegacyMetricCreation
    ? !hasFactTables
    : !hasLegacyMetrics && !hasFactTables;

  // Auto-generated metrics inherit the data source's projects, so check that the user has createMetric permission for all of them
  const canCreateMetricsInAllDataSourceProjects =
    permissionsUtil.canCreateMetric({ projects: dataSource.projects });

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
      <Flex align="center" justify="between" mb="3">
        <Box>
          <Flex align="center" gap="3" mb="0">
            <Heading as="h4" size="4" mb="0">
              Metrics
            </Heading>
            <Badge
              label={metrics && metrics.length > 0 ? metrics.length + "" : "0"}
              color="gray"
              radius="medium"
            />
          </Flex>
        </Box>
        {canEdit &&
        envAllowsCreatingMetrics() &&
        canCreateMetricsInAllDataSourceProjects &&
        !showCreateFactTableButton ? (
          <>
            <AutoGenerateMetricsButton
              setShowAutoGenerateMetricsModal={setShowAutoGenerateMetricsModal}
              datasource={dataSource}
              size="sm"
            />
            <Button onClick={() => setModalData({ mode: "new" })}>
              <FaPlus className="mr-1" /> Add
            </Button>
          </>
        ) : permissionsUtil.canCreateFactTable({
            projects: dataSource.projects || [],
          }) ? (
          <LinkButton href="/fact-tables">Create Fact Table</LinkButton>
        ) : null}
      </Flex>
      <Flex gap="2">
        <p className="m-0">
          Metrics are what your experiments are trying to improve (or at least
          not hurt). Below are the metrics defined from this data source.{" "}
          <DocLink docSection="metrics">Learn more.</DocLink>
        </p>
        <Button
          variant="ghost"
          onClick={() => {
            setMetricsOpen(!metricsOpen);
          }}
        >
          <FaChevronRight
            style={{
              transform: `rotate(${metricsOpen ? "90deg" : "0deg"})`,
            }}
          />
        </Button>
      </Flex>
      {metricsOpen ? (
        <Box>
          {metrics && metrics?.length > 0 ? (
            <Box>
              {metrics.map((metric) => {
                return (
                  <Card mt="3" key={metric.id}>
                    <Flex align="start" justify="between" py="2" px="3" gap="3">
                      <div className="pr-3">
                        <div className="mr-5 w-100">
                          <Heading
                            size="3"
                            mb="1"
                            className={metric.archived ? "text-muted" : ""}
                          >
                            <Link href={getMetricLink(metric.id)}>
                              {metric.name}
                            </Link>
                          </Heading>
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
                                "pr-3",
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
                                "pr-3",
                              )}
                            >
                              <strong>Projects: </strong>
                              {!metric?.projects?.length ? (
                                <ProjectBadges resourceType="metric" />
                              ) : (
                                <ProjectBadges
                                  resourceType="metric"
                                  projectIds={metric.projects}
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
                                  "d-none d-md-table-cell",
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
                    </Flex>
                  </Card>
                );
              })}
            </Box>
          ) : (
            <div className="alert alert-info">
              No metrics have been defined yet from this data source. Click the{" "}
              <strong>
                {showCreateFactTableButton ? "Create Fact Table" : "Add"}
              </strong>{" "}
              button to create your first one.
            </div>
          )}
        </Box>
      ) : null}
    </>
  );
}
