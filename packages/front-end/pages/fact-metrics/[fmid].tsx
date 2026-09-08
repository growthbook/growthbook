import { useRouter } from "next/router";
import { useState } from "react";
import { FaChartLine } from "react-icons/fa";
import { isFactFunnelMetric } from "shared/experiments";

import { Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBBandit, GBEdit, GBExperiment } from "@/components/Icons";
import { useAuth } from "@/services/auth";
import EditProjectsForm from "@/components/Projects/EditProjectsForm";
import PageHead from "@/components/Layout/PageHead";
import MetricWorkspace from "@/components/FactTables/MetricEditor/MetricWorkspace";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Tooltip from "@/ui/Tooltip";
import MetricName from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import MetricAnalysis from "@/components/MetricAnalysis/MetricAnalysis";
import MetricExperiments from "@/components/MetricExperiments/MetricExperiments";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import HistoryTable from "@/components/HistoryTable";
import Modal from "@/components/Modal";
import OpenInExplorerButton from "@/enterprise/components/ProductAnalytics/OpenInExplorerButton";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import OfficialResourceModal from "@/components/OfficialResourceModal";
import { useUser } from "@/services/UserContext";
import {
  isMergeAggregationMetric,
  REST_API_ONLY_EDIT_MESSAGE,
} from "@/services/factMetrics";
import {
  ReplacedByCallout,
  ReplacesMetadata,
} from "@/components/Metrics/MetricReplacement";

export default function FactMetricPage() {
  const router = useRouter();
  const { fmid } = router.query;

  const [isEditing, setIsEditing] = useState(false);

  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);
  const [auditModal, setAuditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(false);
  const [showConvertToOfficialModal, setShowConvertToOfficialModal] =
    useState(false);

  const [tab, setTab] = useLocalStorage<string | null>(
    `metricTabbedPageTab__${fmid}`,
    "analysis",
  );
  const { apiCall } = useAuth();

  const { hasCommercialFeature, getOwnerDisplay } = useUser();

  const permissionsUtil = usePermissionsUtil();

  const {
    getFactMetricById,
    ready,
    mutateDefinitions,
    getProjectById,
    projects,
    getDatasourceById,
  } = useDefinitions();

  if (!ready) return <LoadingOverlay />;

  const factMetric = getFactMetricById(fmid as string);

  if (!factMetric) {
    return (
      <Callout status="error">
        Could not find the requested metric.{" "}
        <Link href="/metrics">Back to all metrics</Link>
      </Callout>
    );
  }

  let canEdit = permissionsUtil.canUpdateFactMetric(factMetric, {});
  let canDelete = permissionsUtil.canDeleteFactMetric(factMetric);
  const editViaApiOnly = isMergeAggregationMetric(factMetric);

  if (
    factMetric.managedBy &&
    ["api", "config"].includes(factMetric.managedBy)
  ) {
    canEdit = false;
    canDelete = false;
  }

  const datasource = factMetric.datasource
    ? getDatasourceById(factMetric.datasource)
    : null;
  const canOpenInExplorer = datasource
    ? permissionsUtil.canRunMetricQueries(datasource)
    : false;

  return (
    <div className="pagecontents container-fluid">
      {auditModal && (
        <Modal
          useRadixButton={false}
          trackingEventModalType=""
          open={true}
          header="Audit Log"
          close={() => setAuditModal(false)}
          size="lg"
          closeCta="Close"
        >
          <HistoryTable type="metric" id={factMetric.id} />
        </Modal>
      )}
      {showConvertToOfficialModal && (
        <OfficialResourceModal
          resourceType="Fact Metric"
          source="fact-metric-page"
          close={() => setShowConvertToOfficialModal(false)}
          onSubmit={async () => {
            await apiCall(`/fact-metrics/${factMetric.id}`, {
              method: "PUT",
              body: JSON.stringify({
                managedBy: "admin",
              }),
            });
            await mutateDefinitions();
          }}
        />
      )}
      {showDeleteModal && (
        <Modal
          useRadixButton={false}
          trackingEventModalType=""
          header={`Delete Metric`}
          close={() => setShowDeleteModal(false)}
          open={true}
          cta="Delete"
          submitColor="danger"
          submit={async () => {
            await apiCall(`/fact-metrics/${factMetric.id}`, {
              method: "DELETE",
            });
            mutateDefinitions();
            setShowDeleteModal(false);
            router.push("/metrics");
          }}
          ctaEnabled={canDelete}
          increasedElevation={true}
        >
          <p>
            Are you sure you want to delete this metric? This action cannot be
            undone.
          </p>
        </Modal>
      )}
      {editProjectsOpen && (
        <EditProjectsForm
          label={
            <>
              Projects{" "}
              <Tooltip
                content={
                  "The dropdown below has been filtered to only include projects where you have permission to update Metrics"
                }
              />
            </>
          }
          value={factMetric.projects}
          permissionRequired={(project) =>
            permissionsUtil.canUpdateFactMetric({ projects: [project] }, {})
          }
          cancel={() => setEditProjectsOpen(false)}
          save={async (projects) => {
            await apiCall(`/fact-metrics/${factMetric.id}`, {
              method: "PUT",
              body: JSON.stringify({
                projects,
              }),
            });
          }}
          mutate={mutateDefinitions}
          entityName="Metric"
        />
      )}
      {editOwnerModal && (
        <EditOwnerModal
          cancel={() => setEditOwnerModal(false)}
          owner={factMetric.owner}
          save={async (owner) => {
            await apiCall(`/fact-metrics/${factMetric.id}`, {
              method: "PUT",
              body: JSON.stringify({ owner }),
            });
          }}
          mutate={mutateDefinitions}
        />
      )}
      <PageHead
        breadcrumb={[
          { display: "Metrics", href: "/metrics" },
          { display: factMetric.name },
        ]}
      />

      {factMetric.archived && (
        <Callout status="info" mb="2">
          <strong>This metric is archived.</strong> Existing references will
          continue working, but you will be unable to add this metric to new
          experiments.
        </Callout>
      )}
      <ReplacedByCallout metricId={factMetric.id} />
      <Flex align="start" justify="between" gap="2" mb="2">
        <Flex align="center" gap="3" style={{ marginTop: "-4px" }}>
          <Heading size="xl" as="h1" overflowWrap="anywhere" mb="0">
            <MetricName id={factMetric.id} officialBadgePosition="right" />
          </Heading>
        </Flex>
        <Flex align="center" gap="2" pr="2">
          {!isEditing && (
            <Tooltip
              content={REST_API_ONLY_EDIT_MESSAGE}
              enabled={editViaApiOnly}
            >
              <Button
                variant="soft"
                disabled={!canEdit || editViaApiOnly}
                onClick={() => setIsEditing(true)}
              >
                Edit metric
              </Button>
            </Tooltip>
          )}
          <OpenInExplorerButton
            enabled={canOpenInExplorer}
            // Funnel metrics open in the Funnel Builder, which understands
            // steps; every other type goes to the Metric Explorer as before.
            href={
              isFactFunnelMetric(factMetric)
                ? `/product-analytics/explore/funnel?funnelMetricId=${encodeURIComponent(
                    factMetric.id,
                  )}`
                : `/product-analytics/explore/metrics?metricId=${encodeURIComponent(
                    factMetric.id,
                  )}`
            }
            tooltip={
              isFactFunnelMetric(factMetric)
                ? "Open this funnel in the Funnel Builder to explore its steps, break them down by dimension, and try changes without affecting the metric."
                : "Open this Fact Metric in the Product Analytics Explorer to view trends, compare time periods, and slice/dice a metric."
            }
          />
          <DropdownMenu
            trigger={
              <IconButton
                variant="ghost"
                color="gray"
                radius="full"
                size="2"
                highContrast
              >
                <BsThreeDotsVertical size={16} />
              </IconButton>
            }
            menuPlacement="end"
            open={openDropdown}
            onOpenChange={setOpenDropdown}
          >
            <DropdownMenuItem
              onClick={() => {
                setOpenDropdown(false);
                setIsEditing(true);
              }}
              disabled={!canEdit || editViaApiOnly}
            >
              <Tooltip
                content={REST_API_ONLY_EDIT_MESSAGE}
                enabled={editViaApiOnly}
              >
                <span>Edit Metric</span>
              </Tooltip>
            </DropdownMenuItem>
            {canEdit &&
            !factMetric.managedBy &&
            permissionsUtil.canCreateOfficialResources(factMetric) &&
            hasCommercialFeature("manage-official-resources") ? (
              <DropdownMenuItem
                onClick={() => {
                  setOpenDropdown(false);
                  setShowConvertToOfficialModal(true);
                }}
              >
                Convert to Official Metric
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onClick={() => {
                setOpenDropdown(false);
                setAuditModal(true);
              }}
            >
              Audit log
            </DropdownMenuItem>
            {canEdit || canDelete ? <DropdownMenuSeparator /> : null}
            {canEdit && (
              <DropdownMenuItem
                onClick={async () => {
                  setOpenDropdown(false);
                  await apiCall(`/fact-metrics/${factMetric.id}`, {
                    method: "PUT",
                    body: JSON.stringify({
                      archived: !factMetric.archived,
                    }),
                  });
                  mutateDefinitions();
                }}
              >
                {factMetric.archived ? "Unarchive" : "Archive"}
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem
                color="red"
                onClick={() => {
                  setOpenDropdown(false);
                  setShowDeleteModal(true);
                }}
              >
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenu>
        </Flex>
      </Flex>
      <Flex gap="4" align="center" wrap="wrap">
        {projects.length > 0 && (
          <Metadata
            label="Projects"
            value={
              <Flex gap="1" align="center">
                {factMetric.projects.length > 0 ? (
                  <Text weight="regular" color="text-mid">
                    {factMetric.projects
                      .map((p) => getProjectById(p)?.name || p)
                      .join(", ")}
                  </Text>
                ) : (
                  <Text weight="regular" color="text-mid" fontStyle="italic">
                    All Projects
                  </Text>
                )}
                {canEdit ? (
                  <Link
                    onClick={(e) => {
                      e.preventDefault();
                      setEditProjectsOpen(true);
                    }}
                  >
                    <GBEdit />
                  </Link>
                ) : (
                  <span style={{ opacity: 0.4, cursor: "not-allowed" }}>
                    <GBEdit />
                  </span>
                )}
              </Flex>
            }
          />
        )}
        <Metadata
          label="Owner"
          value={
            <Flex gap="1" align="center">
              <Text weight="regular" color="text-mid">
                {getOwnerDisplay(factMetric.owner) || "None"}
              </Text>
              {canEdit ? (
                <Link onClick={() => setEditOwnerModal(true)}>
                  <GBEdit />
                </Link>
              ) : (
                <span style={{ opacity: 0.4, cursor: "not-allowed" }}>
                  <GBEdit />
                </span>
              )}
            </Flex>
          }
        />
        <Metadata
          label="Data source"
          value={
            <Link
              href={`/datasources/${factMetric.datasource}`}
              className="font-weight-bold"
            >
              {datasource?.name || "Unknown"}
            </Link>
          }
        />
        <ReplacesMetadata replaces={factMetric.replaces} />
      </Flex>

      <MetricWorkspace
        existing={factMetric}
        isEditing={isEditing}
        setIsEditing={setIsEditing}
        mutate={mutateDefinitions}
      />

      <Tabs value={tab ?? undefined} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="analysis">
            <FaChartLine className="mr-1" size={16} />
            Metric Analysis
          </TabsTrigger>
          <TabsTrigger value="experiments">
            <GBExperiment className="mr-1" />
            Experiments
          </TabsTrigger>
          <TabsTrigger value="bandits">
            <GBBandit className="mr-1" />
            Bandits
          </TabsTrigger>
        </TabsList>

        <TabsContent value="analysis">
          {datasource ? (
            <MetricAnalysis
              factMetric={factMetric}
              datasource={datasource}
              className="tabbed-content"
            />
          ) : null}
        </TabsContent>

        <TabsContent value="experiments">
          <MetricExperiments metric={factMetric} />
        </TabsContent>

        <TabsContent value="bandits">
          <MetricExperiments metric={factMetric} bandits={true} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
