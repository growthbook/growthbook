import { useRouter } from "next/router";
import Link from "next/link";
import { useState } from "react";
import { FaExternalLinkAlt, FaTimes } from "react-icons/fa";
import { ColumnRef, FactTableInterface } from "back-end/types/fact-table";
import { FaTriangleExclamation } from "react-icons/fa6";
import { quantileMetricType } from "shared/experiments";
import {
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBCuped, GBEdit } from "@/components/Icons";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import EditProjectsForm from "@/components/Projects/EditProjectsForm";
import PageHead from "@/components/Layout/PageHead";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import SortedTags from "@/components/Tags/SortedTags";
import FactMetricModal from "@/components/FactTables/FactMetricModal";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import RightRailSectionGroup from "@/components/Layout/RightRailSectionGroup";
import RightRailSection from "@/components/Layout/RightRailSection";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { getPercentileLabel } from "@/services/metrics";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import Tooltip from "@/components/Tooltip/Tooltip";
import { capitalizeFirstLetter } from "@/services/utils";
import MetricName from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { MetricPriorRightRailSectionGroup } from "@/components/Metrics/MetricPriorRightRailSectionGroup";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";

function FactTableLink({ id }: { id?: string }) {
  const { getFactTableById } = useDefinitions();
  const factTable = getFactTableById(id || "");

  if (!factTable) return <em className="text-muted">Unknown Fact Table</em>;

  return (
    <Link href={`/fact-tables/${factTable.id}`} className="font-weight-bold">
      {factTable.name} <FaExternalLinkAlt />
    </Link>
  );
}

export function FilterBadges({
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
        <strong>Mean Metric</strong> - The average value of a numeric Fact among
        all experiment users
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

function ColumnRefSQL({
  columnRef,
  isProportion,
  quantileType,
  showFrom,
}: {
  columnRef: ColumnRef | null;
  isProportion?: boolean;
  quantileType?: "" | "unit" | "event";
  showFrom?: boolean;
}) {
  const { getFactTableById } = useDefinitions();
  if (!columnRef) return null;
  const factTable = getFactTableById(columnRef.factTableId);
  if (!factTable) return null;

  const id = isProportion ? "$$distinctUsers" : columnRef.column;

  const colData = factTable.columns.find((c) => c.column === columnRef.column);

  const name = colData?.name;

  const where: string[] = [];
  columnRef.filters.forEach((filterId) => {
    const filter = factTable.filters.find((f) => f.id === filterId);
    if (!filter) return;

    where.push(`\`${filter.name}\``);
  });

  const column =
    id === "$$count"
      ? "COUNT(*)"
      : id === "$$distinctUsers"
      ? `COUNT(DISTINCT \`User Identifier\`)`
      : quantileType === "event"
      ? `\`${name || columnRef.column}\``
      : `SUM(\`${name || columnRef.column}\`)`;

  const from = showFrom ? `\nFROM \`${factTable.name}\`` : "";

  const sqlExtra = where.length > 0 ? `\nWHERE ${where.join(" AND ")}` : "";
  const groupBy = quantileType === "unit" ? `\nGROUP BY \`Identifier\`` : "";

  return (
    <div className="d-flex align-items-center">
      <InlineCode language="sql" code={column + from + sqlExtra + groupBy} />
      {colData?.deleted && (
        <div className="ml-2">
          <Tooltip body="This column is no longer being returned from the Fact Table">
            <div className="rounded alert-danger px-2 py-1">
              <FaTriangleExclamation />
            </div>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

export default function FactMetricPage() {
  const router = useRouter();
  const { fmid } = router.query;

  const [editOpen, setEditOpen] = useState(false);

  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);

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
        />
      )}
      <PageHead
        breadcrumb={[
          { display: "Metrics", href: "/metrics" },
          { display: factMetric.name },
        ]}
      />
      <div className="row mb-3">
        <div className="col-auto">
          <h1 className="mb-0">
            <MetricName id={factMetric.id} />
          </h1>
        </div>
        <div className="ml-auto">
          <MoreMenu>
            {canEdit ? (
              <button
                className="dropdown-item"
                onClick={(e) => {
                  e.preventDefault();
                  setEditOpen(true);
                }}
              >
                Edit Metric
              </button>
            ) : null}
            {canDelete ? (
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
            ) : null}
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
            {getDatasourceById(factMetric.datasource)?.name || "Unknown"}
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
              <div className="d-flex mb-3">
                <strong className="mr-2" style={{ width: 120 }}>
                  {factMetric.metricType === "quantile"
                    ? `${capitalizeFirstLetter(
                        quantileMetricType(factMetric)
                      )} Quantile`
                    : "Numerator"}
                </strong>
                <div>
                  {factMetric.metricType === "quantile" ? (
                    <div className="mb-1">
                      {factMetric.metricType === "quantile"
                        ? `${getPercentileLabel(
                            factMetric.quantileSettings?.quantile ?? 0.5
                          )} ${
                            factMetric.quantileSettings?.ignoreZeros
                              ? ", ignoring zeros, "
                              : ""
                          } of`
                        : null}
                    </div>
                  ) : null}
                  <ColumnRefSQL
                    columnRef={factMetric.numerator}
                    showFrom={true}
                    quantileType={quantileMetricType(factMetric)}
                    isProportion={factMetric.metricType === "proportion"}
                  />
                </div>
                <div className="ml-auto">
                  View Fact Table:{" "}
                  <FactTableLink id={factMetric.numerator.factTableId} />
                </div>
              </div>
              {factMetric.metricType !== "quantile" ? (
                <>
                  <hr />
                  <div className="d-flex">
                    <strong className="mr-2" style={{ width: 120 }}>
                      Denominator
                    </strong>
                    <div>
                      {factMetric.metricType === "ratio" ? (
                        <ColumnRefSQL
                          columnRef={factMetric.denominator}
                          showFrom={true}
                        />
                      ) : (
                        <em>All Experiment Users</em>
                      )}
                    </div>
                    {factMetric.metricType === "ratio" &&
                      factMetric.denominator?.factTableId &&
                      factMetric.denominator.factTableId !==
                        factMetric.numerator.factTableId && (
                        <div className="ml-auto">
                          View Fact Table:{" "}
                          <FactTableLink
                            id={factMetric.denominator.factTableId}
                          />
                        </div>
                      )}
                  </div>{" "}
                </>
              ) : null}
            </div>
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

          <div className="alert alert-info">
            Fact Metrics are brand new and are somewhat limited in functionality
            right now. We have a lot planned here, so stay tuned!
          </div>
        </div>
        <div className="col-12 col-md-4">
          <div className="appbox p-3" style={{ marginTop: "7px" }}>
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
                    factMetric.cappingSettings.value && (
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
    </div>
  );
}
