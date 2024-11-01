import { useRouter } from "next/router";
import Link from "next/link";
import { useState } from "react";
import { FaChartLine, FaExternalLinkAlt, FaTimes } from "react-icons/fa";
import { FactTableInterface } from "back-end/types/fact-table";
import { getAggregateFilters, quantileMetricType } from "shared/experiments";
import {
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";

import { useGrowthBook } from "@growthbook/growthbook-react";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBBandit, GBCuped, GBEdit, GBExperiment } from "@/components/Icons";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
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
import { getPercentileLabel } from "@/services/metrics";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import Tooltip from "@/components/Tooltip/Tooltip";
import { capitalizeFirstLetter } from "@/services/utils";
import MetricName from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MetricPriorRightRailSectionGroup from "@/components/Metrics/MetricPriorRightRailSectionGroup";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import MetricAnalysis from "@/components/MetricAnalysis/MetricAnalysis";
import MetricExperiments from "@/components/MetricExperiments/MetricExperiments";
import Tab from "@/components/Tabs/Tab";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import DataList, { DataListItem } from "@/components/Radix/DataList";
import useOrgSettings from "@/hooks/useOrgSettings";
import { AppFeatures } from "@/types/app-features";

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
  type: "proportion" | "mean" | "ratio" | "quantile";
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

  const [editOpen, setEditOpen] = useState(false);

  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);

  const [tab, setTab] = useLocalStorage<string | null>(
    `metricTabbedPageTab__${fmid}`,
    "analysis"
  );
  const { apiCall } = useAuth();

  const permissionsUtil = usePermissionsUtil();

  const settings = useOrgSettings();

  const {
    metricDefaults,
    getMinSampleSizeForMetric,
    getMinPercentageChangeForMetric,
    getMaxPercentageChangeForMetric,
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

  let regressionAdjustmentAvailableForMetric = true;
  let regressionAdjustmentAvailableForMetricReason = <></>;
  if (factMetric.metricType === "ratio") {
    regressionAdjustmentAvailableForMetric = false;
    regressionAdjustmentAvailableForMetricReason = (
      <>Not available for ratio metrics.</>
    );
  }

  const factTable = getFactTableById(factMetric.numerator.factTableId);
  const denominatorFactTable = getFactTableById(
    factMetric.denominator?.factTableId || ""
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
    ...(factMetric.metricType !== "proportion"
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
            value: "SUM",
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
              factMetric.quantileSettings?.quantile ?? 0.5
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
                  value: "SUM",
                },
              ]
            : []),
        ]
      : [];

  return (
    <div className="pagecontents container-fluid">
      {editOpen && (
        <FactMetricModal
          close={() => setEditOpen(false)}
          existing={factMetric}
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
            <MetricName id={factMetric.id} />
          </h1>
        </div>
        <div className="ml-auto">
          <MoreMenu>
            {canEdit && (
              <button
                className="dropdown-item"
                onClick={(e) => {
                  e.preventDefault();
                  setEditOpen(true);
                }}
              >
                Edit Metric
              </button>
            )}
            {canDelete && (
              <DeleteButton
                className="dropdown-item"
                displayName="Metric"
                useIcon={false}
                text="Delete Metric"
                onClick={async () => {
                  await apiCall(`/fact-metrics/${factMetric.id}`, {
                    method: "DELETE",
                  });
                  mutateDefinitions();
                  router.push("/metrics");
                }}
              />
            )}
            {canEdit && (
              <button
                className="btn dropdown-item"
                onClick={async () => {
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
              </button>
            )}
          </MoreMenu>
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
              canCreate={canEdit}
              canEdit={canEdit}
              value={factMetric.description}
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
                  {factMetric.windowSettings.delayHours
                    ? " plus the conversion delay"
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
                  {factMetric.windowSettings.delayHours
                    ? " plus the conversion delay"
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
              open={() => setEditOpen(true)}
              canOpen={canEdit}
            >
              {factMetric.windowSettings.delayHours > 0 && (
                <RightRailSectionGroup type="custom" empty="" className="mt-3">
                  <ul className="right-rail-subsection list-unstyled mb-4">
                    <li className="mt-3 mb-1">
                      <span className="uppercase-title lg">Metric Delay</span>
                    </li>
                    <li className="mb-2">
                      <span className="font-weight-bold">
                        {factMetric.windowSettings.delayHours} hours
                      </span>
                    </li>
                  </ul>
                </RightRailSectionGroup>
              )}

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
                              factMetric.cappingSettings.type
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
                    <span className="uppercase-title lg">Thresholds</span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Minimum sample size:</span>{" "}
                    <span className="font-weight-bold">
                      {getMinSampleSizeForMetric(factMetric)}
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Max percent change:</span>{" "}
                    <span className="font-weight-bold">
                      {getMaxPercentageChangeForMetric(factMetric) * 100}%
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">Min percent change :</span>{" "}
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
                  {!regressionAdjustmentAvailableForMetric ? (
                    <li className="mb-2">
                      <div className="text-muted small">
                        <FaTimes className="text-danger" />{" "}
                        {regressionAdjustmentAvailableForMetricReason}
                      </div>
                    </li>
                  ) : factMetric?.regressionAdjustmentOverride ? (
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
      <div className="row align-items-center">
        <ControlledTabs
          orientation="horizontal"
          className="col"
          buttonsClassName="mb-0 d-flex align-items-center"
          buttonsWrapperClassName="border-bottom-0 large shiftdown-1"
          defaultTab="analysis"
          newStyle={false}
          showActiveCount={false}
          active={tab}
          setActive={setTab}
        >
          <Tab
            display={
              <>
                <FaChartLine className="mr-1" size={16} />
                Metric Analysis
              </>
            }
            id="analysis"
            anchor="analysis"
            padding={false}
            lazy={true}
          >
            {datasource ? (
              <MetricAnalysis
                factMetric={factMetric}
                datasource={datasource}
                className="tabbed-content"
              />
            ) : null}
          </Tab>
          <Tab
            display={
              <>
                <GBExperiment className="mr-1" />
                Experiments
              </>
            }
            id="experiments"
            anchor="experiments"
            padding={false}
            lazy={true}
          >
            <MetricExperiments metric={factMetric} />
          </Tab>
          {growthbook.isOn("bandits") ? (
            <Tab
              display={
                <>
                  <GBBandit className="mr-1" />
                  Bandits
                </>
              }
              id="bandits"
              anchor="bandits"
              padding={false}
              lazy={true}
            >
              <MetricExperiments metric={factMetric} bandits={true} />
            </Tab>
          ) : null}
        </ControlledTabs>
      </div>
    </div>
  );
}
