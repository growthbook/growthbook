import { useRouter } from "next/router";
import Link from "next/link";
import { useState } from "react";
import { FaChartLine, FaExternalLinkAlt } from "react-icons/fa";
import { FactTableInterface } from "back-end/types/fact-table";
import {
  getAggregateFilters,
  isBinomialMetric,
  isRatioMetric,
  quantileMetricType,
} from "shared/experiments";
import {
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";

import { useGrowthBook } from "@growthbook/growthbook-react";
import { IconButton, Switch } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBBandit, GBCuped, GBEdit, GBExperiment } from "@/components/Icons";
import { useAuth } from "@/services/auth";
import EditProjectsForm from "@/components/Projects/EditProjectsForm";
import PageHead from "@/components/Layout/PageHead";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import SortedTags from "@/components/Tags/SortedTags";
import FactMetricModal from "@/components/FactTables/FactMetricModal";
import RightRailSectionGroup from "@/components/Layout/RightRailSectionGroup";
import RightRailSection from "@/components/Layout/RightRailSection";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import {
  formatNumber,
  getExperimentMetricFormatter,
  getPercentileLabel,
} from "@/services/metrics";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import Tooltip from "@/components/Tooltip/Tooltip";
import { capitalizeFirstLetter } from "@/services/utils";
import MetricName from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MetricPriorRightRailSectionGroup from "@/components/Metrics/MetricPriorRightRailSectionGroup";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import MetricAnalysis from "@/components/MetricAnalysis/MetricAnalysis";
import MetricExperiments from "@/components/MetricExperiments/MetricExperiments";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import DataList, { DataListItem } from "@/ui/DataList";
import useOrgSettings from "@/hooks/useOrgSettings";
import { AppFeatures } from "@/types/app-features";
import { useCurrency } from "@/hooks/useCurrency";
import HistoryTable from "@/components/HistoryTable";
import Modal from "@/components/Modal";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { useUser } from "@/services/UserContext";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import track from "@/services/track";

function FactTableLink({ id }: { id?: string }) {
  const { getFactTableById } = useDefinitions();
  const factTable = getFactTableById(id || "");

  if (!factTable) return <em className="text-muted">Unknown Fact Table</em>;

  return (
    <Link href={`/fact-tables/${factTable.id}`}>
      {factTable.name} <FaExternalLinkAlt />
    </Link>
  );
}

function FilterBadges({
  ids,
  factTable,
}: {
  ids: string[] | null | undefined;
  factTable?: FactTableInterface | null;
}) {
  if (!factTable || !ids) return null;

  return (
    <>
      {ids.map((id) => {
        const filter = factTable.filters.find((f) => f.id === id);
        if (!filter) return null;
        return (
          <span className="badge badge-secondary mr-2" key={filter.id}>
            {filter.name}
          </span>
        );
      })}
    </>
  );
}

function MetricType({
  type,
  quantileType,
}: {
  type: "proportion" | "retention" | "mean" | "ratio" | "quantile";
  quantileType?: "" | "unit" | "event";
}) {
  if (type === "proportion") {
    return (
      <div>
        <strong>Proportion Metric</strong> - Percent of experiment users who
        exist in a Fact Table
      </div>
    );
  }
  if (type === "retention") {
    return (
      <div>
        <strong>Retention Metric</strong> - Percent of experiment users who
        exist in a Fact Table a certain period after experiment exposure
      </div>
    );
  }
  if (type === "mean") {
    return (
      <div>
        <strong>Mean Metric</strong> - The average of a numeric value among all
        experiment users
      </div>
    );
  }
  if (type === "ratio") {
    return (
      <div>
        <strong>Ratio Metric</strong> - The ratio of two numeric values among
        experiment users
      </div>
    );
  }
  if (type === "quantile") {
    return (
      <div>
        <strong>Quantile Metric</strong> - The quantile of values{" "}
        {quantileType === "unit" ? "after aggregating per user" : ""}
      </div>
    );
  }

  return null;
}

export default function FactMetricPage() {
  const router = useRouter();
  const { fmid } = router.query;

  const [editOpen, setEditOpen] = useState<
    "closed" | "open" | "openWithAdvanced"
  >("closed");

  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);
  const [auditModal, setAuditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(false);

  const [tab, setTab] = useLocalStorage<string | null>(
    `metricTabbedPageTab__${fmid}`,
    "analysis",
  );
  const { apiCall } = useAuth();

  const permissionsUtil = usePermissionsUtil();

  const settings = useOrgSettings();

  const displayCurrency = useCurrency();

  const {
    metricDefaults,
    getMinSampleSizeForMetric,
    getMinPercentageChangeForMetric,
    getMaxPercentageChangeForMetric,
    getTargetMDEForMetric,
  } = useOrganizationMetricDefaults();

  const {
    getFactMetricById,
    getFactTableById,
    ready,
    mutateDefinitions,
    getProjectById,
    projects,
    getDatasourceById,
  } = useDefinitions();
  const growthbook = useGrowthBook<AppFeatures>();
  const { hasCommercialFeature } = useUser();

  // Feature flag and commercial feature checks for dimension analysis
  const isMetricDimensionsFeatureEnabled =
    growthbook?.isOn("metric-dimensions") || false;
  const hasMetricDimensionsFeature = hasCommercialFeature("metric-dimensions");

  if (!ready) return <LoadingOverlay />;

  const factMetric = getFactMetricById(fmid as string);

  if (!factMetric) {
    return (
      <div className="alert alert-danger">
        Could not find the requested metric.{" "}
        <Link href="/metrics">Back to all metrics</Link>
      </div>
    );
  }

  const canEdit =
    permissionsUtil.canUpdateFactMetric(factMetric, {}) &&
    !factMetric.managedBy;
  const canDelete =
    permissionsUtil.canDeleteFactMetric(factMetric) && !factMetric.managedBy;

  const factTable = getFactTableById(factMetric.numerator.factTableId);
  const denominatorFactTable = getFactTableById(
    factMetric.denominator?.factTableId || "",
  );

  const datasource = factMetric.datasource
    ? getDatasourceById(factMetric.datasource)
    : null;

  const userFilters = getAggregateFilters({
    columnRef: factMetric.numerator,
    column:
      factMetric.numerator.aggregateFilterColumn === "$$count"
        ? `COUNT(*)`
        : `SUM(${factMetric.numerator.aggregateFilterColumn})`,
    ignoreInvalid: true,
  });

  const numeratorData: DataListItem[] = [
    {
      label: `Fact Table`,
      value: <FactTableLink id={factMetric.numerator.factTableId} />,
    },
    ...Object.entries(factMetric.numerator.inlineFilters || {})
      .filter(([, v]) => v.some((v) => !!v))
      .map(([k, v]) => {
        const columnName =
          factTable?.columns.find((c) => c.column === k)?.name || k;
        return {
          label: columnName,
          value: v.join(" OR "),
        };
      }),
    {
      label: `Row Filter`,
      value:
        factMetric.numerator.filters.length > 0 ? (
          <FilterBadges
            factTable={factTable}
            ids={factMetric.numerator.filters}
          />
        ) : (
          <em>None</em>
        ),
    },
    ...(!isBinomialMetric(factMetric)
      ? [
          {
            label: `Value`,
            value:
              factMetric.numerator.column === "$$count"
                ? "Count of Rows"
                : factMetric.numerator.column === "$$distinctUsers"
                  ? "Unique Users"
                  : factMetric.numerator.column,
          },
        ]
      : []),
    ...(!factMetric.numerator.column.startsWith("$$") &&
    (factMetric.metricType !== "quantile" ||
      factMetric.quantileSettings?.type === "unit")
      ? [
          {
            label: "Per-User Aggregation",
            value: (factMetric.numerator.aggregation || "SUM").toUpperCase(),
          },
        ]
      : userFilters.length > 0
        ? [
            {
              label: "User Filter",
              value: userFilters.join(" AND "),
            },
          ]
        : []),
    ...(factMetric.metricType === "quantile"
      ? [
          {
            label: "Quantile Scope",
            value: factMetric.quantileSettings?.type,
          },
          {
            label: "Ignore Zeros",
            value: factMetric.quantileSettings?.ignoreZeros ? "Yes" : "No",
          },
          {
            label: "Quantile",
            value: getPercentileLabel(
              factMetric.quantileSettings?.quantile ?? 0.5,
            ),
          },
        ]
      : []),
  ];

  const denominatorData: DataListItem[] =
    factMetric.metricType === "ratio" &&
    factMetric.denominator &&
    denominatorFactTable
      ? [
          {
            label: `Fact Table`,
            value: <FactTableLink id={factMetric.denominator.factTableId} />,
          },
          ...Object.entries(factMetric.denominator.inlineFilters || {})
            .filter(([, v]) => v.some((v) => !!v))
            .map(([k, v]) => {
              const columnName =
                denominatorFactTable?.columns.find((c) => c.column === k)
                  ?.name || k;
              return {
                label: columnName,
                value: v.join(" OR "),
              };
            }),
          {
            label: `Row Filter`,
            value:
              factMetric.denominator.filters.length > 0 ? (
                <FilterBadges
                  factTable={denominatorFactTable}
                  ids={factMetric.denominator.filters}
                />
              ) : (
                <em>None</em>
              ),
          },
          {
            label: `Value`,
            value:
              factMetric.denominator.column === "$$count"
                ? "Count of Rows"
                : factMetric.denominator.column === "$$distinctUsers"
                  ? "Unique Users"
                  : factMetric.denominator.column,
          },
          ...(!factMetric.denominator.column.startsWith("$$")
            ? [
                {
                  label: "Per-User Aggregation",
                  value: (
                    factMetric.denominator.aggregation || "SUM"
                  ).toUpperCase(),
                },
              ]
            : []),
        ]
      : [];

  return (
    <div className="pagecontents container-fluid">
      {auditModal && (
        <Modal
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
      {showDeleteModal && (
        <Modal
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
      {editOpen !== "closed" && (
        <FactMetricModal
          close={() => setEditOpen("closed")}
          existing={factMetric}
          showAdvancedSettings={editOpen === "openWithAdvanced"}
          source="fact-metric"
        />
      )}
      {editProjectsOpen && (
        <EditProjectsForm
          label={
            <>
              Projects{" "}
              <Tooltip
                body={
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
          resourceType="factMetric"
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
      {editTagsModal && (
        <EditTagsForm
          tags={factMetric.tags}
          save={async (tags) => {
            await apiCall(`/fact-metrics/${factMetric.id}`, {
              method: "PUT",
              body: JSON.stringify({ tags }),
            });
          }}
          cancel={() => setEditTagsModal(false)}
          mutate={mutateDefinitions}
          source="fmid"
        />
      )}
      <PageHead
        breadcrumb={[
          { display: "Metrics", href: "/metrics" },
          { display: factMetric.name },
        ]}
      />
      {factMetric.archived && (
        <div className="alert alert-secondary mb-2">
          <strong>This metric is archived.</strong> Existing references will
          continue working, but you will be unable to add this metric to new
          experiments.
        </div>
      )}
      <div className="row mb-3">
        <div className="col-auto">
          <h1 className="mb-0">
            <MetricName id={factMetric.id} officialBadgePosition="right" />
          </h1>
        </div>
        <div className="ml-auto mr-2">
          <DropdownMenu
            trigger={
              <IconButton
                variant="ghost"
                color="gray"
                radius="full"
                size="3"
                highContrast
              >
                <BsThreeDotsVertical size={18} />
              </IconButton>
            }
            menuPlacement="end"
            open={openDropdown}
            onOpenChange={setOpenDropdown}
          >
            {canEdit && (
              <DropdownMenuItem
                onClick={() => {
                  setOpenDropdown(false);
                  setEditOpen("open");
                }}
              >
                Edit Metric
              </DropdownMenuItem>
            )}
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
        </div>
      </div>
      <div className="row mb-4">
        {projects.length > 0 ? (
          <div className="col-auto">
            Projects:{" "}
            {factMetric.projects.length > 0 ? (
              factMetric.projects.map((p) => (
                <span className="badge badge-secondary mr-1" key={p}>
                  {getProjectById(p)?.name || p}
                </span>
              ))
            ) : (
              <em className="mr-1">All Projects</em>
            )}
            {canEdit && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setEditProjectsOpen(true);
                }}
              >
                <GBEdit />
              </a>
            )}
          </div>
        ) : null}
        <div className="col-auto">
          Tags: <SortedTags tags={factMetric.tags} />
          {canEdit && (
            <a
              className="ml-1 cursor-pointer"
              onClick={() => setEditTagsModal(true)}
            >
              <GBEdit />
            </a>
          )}
        </div>
        <div className="col-auto">
          Owner:{` ${factMetric.owner ?? ""}`}
          {canEdit && (
            <a
              className="ml-1 cursor-pointer"
              onClick={() => setEditOwnerModal(true)}
            >
              <GBEdit />
            </a>
          )}
        </div>
        <div className="col-auto">
          Data source:{" "}
          <Link
            href={`/datasources/${factMetric.datasource}`}
            className="font-weight-bold"
          >
            {datasource?.name || "Unknown"}
          </Link>
        </div>
      </div>

      <div className="row">
        <div className="col-12 col-md-8">
          <div className="appbox p-3 mb-5">
            <MarkdownInlineEdit
              header={"Description"}
              canCreate={canEdit}
              canEdit={canEdit}
              value={factMetric.description}
              aiSuggestFunction={async () => {
                const res = await apiCall<{
                  status: number;
                  data: {
                    description: string;
                  };
                }>(
                  `/metrics/${factMetric.id}/gen-description`,
                  {
                    method: "GET",
                  },
                  (responseData) => {
                    if (responseData.status === 429) {
                      const retryAfter = parseInt(responseData.retryAfter);
                      const hours = Math.floor(retryAfter / 3600);
                      const minutes = Math.floor((retryAfter % 3600) / 60);
                      throw new Error(
                        `You have reached the AI request limit. Try again in ${hours} hours and ${minutes} minutes.`,
                      );
                    } else {
                      throw new Error("Error getting AI suggestion");
                    }
                  },
                );
                if (res?.status !== 200) {
                  throw new Error("Could not load AI suggestions");
                }
                return res.data.description;
              }}
              aiButtonText="Suggest Description"
              aiSuggestionHeader="Suggested Description"
              emptyHelperText="Add a description to keep your team informed about how to apply this metric."
              save={async (description) => {
                await apiCall(`/fact-metrics/${factMetric.id}`, {
                  method: "PUT",
                  body: JSON.stringify({
                    description,
                  }),
                });
                mutateDefinitions();
              }}
            />
          </div>

          <div className="mb-5">
            <h3>Metric Definition</h3>
            <div className="mb-2">
              <MetricType
                type={factMetric.metricType}
                quantileType={quantileMetricType(factMetric)}
              />
            </div>
            <div className="appbox p-3 mb-3">
              <DataList
                data={numeratorData}
                header={
                  factMetric.metricType === "ratio"
                    ? "Numerator"
                    : "Metric Details"
                }
              />
            </div>
            {factMetric.metricType === "ratio" ? (
              <div className="appbox p-3 mb-3">
                <DataList data={denominatorData} header="Denominator" />
              </div>
            ) : null}

            {isMetricDimensionsFeatureEnabled && (
              <div className="appbox p-3 mb-3">
                <h4>
                  Metric Dimensions
                  {!hasMetricDimensionsFeature && (
                    <PaidFeatureBadge
                      commercialFeature="metric-dimensions"
                      premiumText="This is an Enterprise feature"
                      variant="outline"
                      ml="2"
                    />
                  )}
                </h4>
                <div className="d-flex align-items-center mt-3">
                  {hasMetricDimensionsFeature ? (
                    <>
                      <Switch
                        mr="3"
                        checked={factMetric.enableMetricDimensions || false}
                        onCheckedChange={async (checked) => {
                          await apiCall(`/fact-metrics/${factMetric.id}`, {
                            method: "PUT",
                            body: JSON.stringify({
                              enableMetricDimensions: checked,
                            }),
                          });
                          if (checked) {
                            track("dimensions-on-for-metric");
                          } else if (!checked) {
                            track("dimensions-off-for-metric");
                          }
                          mutateDefinitions();
                        }}
                        disabled={!canEdit}
                      />
                      <div>
                        <div className="font-weight-bold mb-1">
                          Enable Dimensions
                        </div>
                        <div className="text-muted">
                          Analyze this metric across dimension values from the
                          fact table&apos;s dimension columns.
                        </div>
                      </div>
                    </>
                  ) : (
                    <div>
                      <div className="font-weight-bold mb-1">
                        Enable Dimensions
                      </div>
                      <div className="text-muted">
                        Analyze this metric across dimension values from the
                        fact table&apos;s dimension columns.
                      </div>
                    </div>
                  )}
                </div>

                {factTable?.columns.some(
                  (col) => col.isDimension && !col.deleted,
                ) ? (
                  <>
                    {factMetric.enableMetricDimensions && (
                      <div className="mt-3">
                        <h5 className="mb-2">Metric Dimensions</h5>
                        <table className="table appbox gbtable mb-0">
                          <thead>
                            <tr>
                              <th>Dimension</th>
                              <th>Dimension Levels</th>
                            </tr>
                          </thead>
                          <tbody>
                            {factTable.columns
                              .filter((col) => col.isDimension && !col.deleted)
                              .map((col) => (
                                <tr key={col.column}>
                                  <td>{col.name || col.column}</td>
                                  <td>
                                    {col.dimensionLevels &&
                                    col.dimensionLevels.length > 0 ? (
                                      <div
                                        className="d-flex flex-wrap"
                                        style={{ gap: 4 }}
                                      >
                                        {col.dimensionLevels.map(
                                          (value, index) => (
                                            <span
                                              key={index}
                                              style={{
                                                fontSize: "0.8em",
                                                padding: "2px 4px",
                                                borderRadius: "3px",
                                                border: "1px solid #e9ecef",
                                              }}
                                            >
                                              {value}
                                            </span>
                                          ),
                                        )}
                                      </div>
                                    ) : (
                                      <em className="text-muted">No values</em>
                                    )}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-muted">
                    <div className="font-weight-bold mb-1">
                      Dimension Analysis Not Available
                    </div>
                    <div>
                      To enable dimension analysis for this metric, configure
                      dimension columns in the{" "}
                      <Link href={`/fact-tables/${factTable?.id}`}>
                        {factTable?.name || "fact table"}
                      </Link>
                      . Dimension columns allow you to analyze metrics across
                      different categorical values.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mb-4">
            <h3>Metric Window</h3>
            <div className="appbox p-3 mb-3">
              {factMetric.windowSettings.type === "conversion" ? (
                <>
                  <em className="font-weight-bold">Conversion Window</em> -
                  Require conversions to happen within{" "}
                  <strong>
                    {factMetric.windowSettings.windowValue}{" "}
                    {factMetric.windowSettings.windowUnit}
                  </strong>{" "}
                  of first experiment exposure
                  {factMetric.metricType === "retention"
                    ? " plus the retention window"
                    : factMetric.windowSettings.delayValue
                      ? " plus the metric delay"
                      : ""}
                  .
                </>
              ) : factMetric.windowSettings.type === "lookback" ? (
                <>
                  <em className="font-weight-bold">Lookback Window</em> -
                  Require metric data to be in latest{" "}
                  <strong>
                    {factMetric.windowSettings.windowValue}{" "}
                    {factMetric.windowSettings.windowUnit}
                  </strong>{" "}
                  of the experiment.
                </>
              ) : (
                <>
                  <em className="font-weight-bold">Disabled</em> - Include all
                  metric data after first experiment exposure
                  {factMetric.metricType === "retention"
                    ? " plus the retention window"
                    : factMetric.windowSettings.delayValue
                      ? " plus the metric delay"
                      : ""}
                  .
                </>
              )}
            </div>
          </div>
        </div>
        <div className="col-12 col-md-4">
          <div className="appbox p-3">
            <RightRailSection
              title="Advanced Settings"
              open={() => setEditOpen("openWithAdvanced")}
              canOpen={canEdit}
            >
              {factMetric.windowSettings.delayValue ? (
                <RightRailSectionGroup type="custom" empty="" className="mt-3">
                  <ul className="right-rail-subsection list-unstyled mb-4">
                    <li className="mt-3 mb-1">
                      <span className="uppercase-title lg">
                        {factMetric.metricType === "retention"
                          ? "Retention Window"
                          : "Metric Delay"}
                      </span>
                    </li>
                    <li className="mb-2">
                      <span className="font-weight-bold">
                        {`${factMetric.windowSettings.delayValue} ${factMetric.windowSettings.delayUnit}`}
                      </span>
                    </li>
                  </ul>
                </RightRailSectionGroup>
              ) : null}

              <RightRailSectionGroup type="custom" empty="" className="mt-3">
                <ul className="right-rail-subsection list-unstyled mb-4">
                  {factMetric.inverse && (
                    <li className="mb-2">
                      <span className="text-gray">Goal:</span>{" "}
                      <span className="font-weight-bold">Inverse</span>
                    </li>
                  )}
                  {factMetric.cappingSettings.type &&
                    !!factMetric.cappingSettings.value && (
                      <>
                        <li className="mb-2">
                          <span className="uppercase-title lg">
                            {capitalizeFirstLetter(
                              factMetric.cappingSettings.type,
                            )}
                            {" capping"}
                          </span>
                        </li>
                        <li>
                          <span className="font-weight-bold">
                            {factMetric.cappingSettings.value}
                          </span>{" "}
                          {factMetric.cappingSettings.type === "percentile"
                            ? `(${
                                100 * factMetric.cappingSettings.value
                              } pctile${
                                factMetric.cappingSettings.ignoreZeros
                                  ? ", ignoring zeros"
                                  : ""
                              })`
                            : ""}{" "}
                        </li>
                      </>
                    )}
                </ul>
              </RightRailSectionGroup>

              <RightRailSectionGroup type="custom" empty="">
                <ul className="right-rail-subsection list-unstyled mb-4">
                  <li className="mt-3 mb-1">
                    <span className="uppercase-title lg">
                      Experiment Decision Framework
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Target MDE:</span>{" "}
                    <span className="font-weight-bold">
                      {getTargetMDEForMetric(factMetric) * 100}%
                    </span>
                  </li>
                </ul>
              </RightRailSectionGroup>

              <RightRailSectionGroup type="custom" empty="">
                <ul className="right-rail-subsection list-unstyled mb-4">
                  <li className="mt-3 mb-1">
                    <span className="uppercase-title lg">
                      Display Thresholds
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">{`Minimum ${
                      quantileMetricType(factMetric)
                        ? `${quantileMetricType(factMetric)} count`
                        : `${
                            isRatioMetric(factMetric) ? "numerator" : "metric"
                          } total`
                    }:`}</span>{" "}
                    <span className="font-weight-bold">
                      {quantileMetricType(factMetric)
                        ? formatNumber(getMinSampleSizeForMetric(factMetric))
                        : getExperimentMetricFormatter(
                            factMetric,
                            getFactTableById,
                            "number",
                          )(getMinSampleSizeForMetric(factMetric), {
                            currency: displayCurrency,
                          })}
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Max percent change:</span>{" "}
                    <span className="font-weight-bold">
                      {getMaxPercentageChangeForMetric(factMetric) * 100}%
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Min percent change:</span>{" "}
                    <span className="font-weight-bold">
                      {getMinPercentageChangeForMetric(factMetric) * 100}%
                    </span>
                  </li>
                </ul>
              </RightRailSectionGroup>

              <RightRailSectionGroup type="custom" empty="">
                <ul className="right-rail-subsection list-unstyled mb-4">
                  <li className="mt-3 mb-2">
                    <span className="uppercase-title lg">Risk Thresholds</span>
                    <small className="d-block mb-1 text-muted">
                      Only applicable to Bayesian analyses
                    </small>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Acceptable risk &lt;</span>{" "}
                    <span className="font-weight-bold">
                      {factMetric?.winRisk * 100 ||
                        DEFAULT_WIN_RISK_THRESHOLD * 100}
                      %
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Unacceptable risk &gt;</span>{" "}
                    <span className="font-weight-bold">
                      {factMetric?.loseRisk * 100 ||
                        DEFAULT_LOSE_RISK_THRESHOLD * 100}
                      %
                    </span>
                  </li>
                </ul>
              </RightRailSectionGroup>

              <MetricPriorRightRailSectionGroup
                metric={factMetric}
                metricDefaults={metricDefaults}
              />

              <RightRailSectionGroup type="custom" empty="">
                <ul className="right-rail-subsection list-unstyled mb-2">
                  <li className="mt-3 mb-2">
                    <span className="uppercase-title lg">
                      <GBCuped size={14} /> Regression Adjustment (CUPED)
                    </span>
                  </li>
                  {factMetric?.regressionAdjustmentOverride ? (
                    <>
                      <li className="mb-2">
                        <span className="text-gray">
                          Apply regression adjustment:
                        </span>{" "}
                        <span className="font-weight-bold">
                          {factMetric?.regressionAdjustmentEnabled
                            ? "On"
                            : "Off"}
                        </span>
                      </li>
                      <li className="mb-2">
                        <span className="text-gray">
                          Lookback period (days):
                        </span>{" "}
                        <span className="font-weight-bold">
                          {factMetric?.regressionAdjustmentDays}
                        </span>
                      </li>
                    </>
                  ) : settings.regressionAdjustmentEnabled ? (
                    <>
                      <li className="mb-1">
                        <div className="mb-1">
                          <em className="text-gray">
                            Using organization defaults
                          </em>
                        </div>
                        <div className="ml-2 px-2 border-left">
                          <div className="mb-1 small">
                            <span className="text-gray">
                              Apply regression adjustment:
                            </span>{" "}
                            <span className="font-weight-bold">
                              {settings?.regressionAdjustmentEnabled
                                ? "On"
                                : "Off"}
                            </span>
                          </div>
                          <div className="mb-1 small">
                            <span className="text-gray">
                              Lookback period (days):
                            </span>{" "}
                            <span className="font-weight-bold">
                              {settings?.regressionAdjustmentDays}
                            </span>
                          </div>
                        </div>
                      </li>
                    </>
                  ) : (
                    <li className="mb-2">
                      <div className="mb-1">
                        <em className="text-gray">Disabled</em>
                      </div>
                    </li>
                  )}
                </ul>
              </RightRailSectionGroup>
            </RightRailSection>
          </div>
        </div>
      </div>

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
          {growthbook.isOn("bandits") && (
            <TabsTrigger value="bandits">
              <GBBandit className="mr-1" />
              Bandits
            </TabsTrigger>
          )}
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

        {growthbook.isOn("bandits") && (
          <TabsContent value="bandits">
            <MetricExperiments metric={factMetric} bandits={true} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
