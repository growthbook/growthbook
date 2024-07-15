import { useRouter } from "next/router";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FaExternalLinkAlt, FaQuestionCircle, FaTimes } from "react-icons/fa";
import {
  ColumnRef,
  FactMetricInterface,
  FactTableInterface,
} from "back-end/types/fact-table";
import { FaTriangleExclamation } from "react-icons/fa6";
import { quantileMetricType } from "shared/experiments";
import {
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import {
  CreateMetricAnalysisProps,
  MetricAnalysisInterface,
  MetricAnalysisPopulationType,
  MetricAnalysisResult,
  MetricAnalysisSettings,
} from "@back-end/types/metric-analysis";
import { datetime, getValidDate } from "shared/dates";
import { useForm } from "react-hook-form";
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
import {
  formatNumber,
  getColumnRefFormatter,
  getExperimentMetricFormatter,
  getPercentileLabel,
} from "@/services/metrics";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import Tooltip from "@/components/Tooltip/Tooltip";
import { capitalizeFirstLetter } from "@/services/utils";
import MetricName from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { MetricPriorRightRailSectionGroup } from "@/components/Metrics/MetricPriorRightRailSectionGroup";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import useApi from "@/hooks/useApi";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Toggle from "@/components/Forms/Toggle";
import DateGraph from "@/components/Metrics/DateGraph";
import HistogramGraph from "@/components/Metrics/Histogram";
import IdentifierChooser from "@/components/Metrics/IdentifierChooser";
import PopulationChooser from "@/components/Metrics/PopulationChooser";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";

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

function MetricAnalysisOverview({
  name,
  metricType,
  userIdType,
  result,
  formatter,
  numeratorFormatter,
  denominatorFormatter
}: {
  name: string;
  metricType: string;
  userIdType: string;
  result: MetricAnalysisResult;
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string;
  numeratorFormatter?: (value: number, options?: Intl.NumberFormatOptions) => string;
  denominatorFormatter?: (value: number, options?: Intl.NumberFormatOptions) => string;
}) {
  return (
    <div className="mb-4">
      <div className="row mt-3">
        <div className="col-auto">
          <h4 className="mb-3 mt-1">{name}</h4>
        </div>
      </div>
      <div className="d-flex flex-row align-items-end">
        <div className="ml-0 appbox p-3 text-center row align-items-center">
            <div className="col-auto">
              {metricType === "ratio" && numeratorFormatter && denominatorFormatter ? <>
              <div className="border-bottom">
              {`Numerator: ${numeratorFormatter(result.numerator ?? 0)}`}
              </div>
              <div>
              {`Denominator: ${denominatorFormatter(result.denominator ?? 0)}`}
            </div>
            </> : <> 
              <div className="border-bottom">
              Total: {metricType == "proportion"
                ? formatNumber(result.mean * result.units)
                : formatter(result.units * result.mean)}
              </div>
              <div>
              <code>{userIdType}</code>{": "}{formatNumber(result.units)}
            </div></>}
            </div>
            <div className="col-auto" style={{ fontSize: "2.5em" }}>{"="}
</div>
            <div className="col-auto">
          <div style={{ fontSize: "2.5em" }}>{formatter(result.mean)}</div>
          {metricType === "ratio" ? null : <>{metricType === "proportion" ? "of" : "per"} <code>{userIdType}</code></>}
          </div>
          </div>
      </div>
    </div>
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

type MetricAnalysisSettingsWithoutDates = {
  userIdType: string;
  dimensions: string[];

  lookbackDays: number;

  populationType: MetricAnalysisPopulationType;
  populationId: string | null;
}

export default function FactMetricPage() {
  const router = useRouter();
  const { fmid } = router.query;

  const [editOpen, setEditOpen] = useState(false);

  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);
  const storageKeyAvg = `metric_smoothBy_avg`; // to make metric-specific, include `${mid}`
  const storageKeySum = `metric_smoothBy_sum`;
  const [smoothByAvg, setSmoothByAvg] = useLocalStorage<"day" | "week">(
    storageKeyAvg,
    "day"
  );
  const [smoothBySum, setSmoothBySum] = useLocalStorage<"day" | "week">(
    storageKeySum,
    "day"
  );

  const [hoverDate, setHoverDate] = useState<number | null>(null);
  const onHoverCallback = (ret: { d: number | null }) => {
    setHoverDate(ret.d);
  };
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

  // TODO fetching too much
  const { data, error, mutate } = useApi<{
    metricAnalysis: MetricAnalysisInterface;
  }>(`/metric-analysis/metric/${fmid}`);

  // get latest full object or add reset to default?
  const defaultLookbackDays = settings.metricAnalysisDays ?? 30;
  console.log(data?.metricAnalysis?.settings);

  // todo use old settings!
  const [lookbackSelected, setLookbackSelected] = useState("30");
  useEffect(() => {
    const oldLookback = [7, 14, 30].includes(data?.metricAnalysis?.settings?.lookbackDays ?? defaultLookbackDays) ? `${data?.metricAnalysis?.settings?.lookbackDays}` : `custom`;
    setLookbackSelected(oldLookback);
  },
  [data]);

  const form = useForm<MetricAnalysisSettingsWithoutDates>({
    defaultValues: data?.metricAnalysis?.settings ?? {
          userIdType: "",
          dimensions: [],
          populationType: "factTable",
          populationId: null,
        },
  });
  console.log(typeof form.getValues("lookbackDays"))


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

  // TODO fetch stale iff?
  // out of date iff?
  const factTable = getFactTableById(factMetric.numerator.factTableId);
  if (form.watch("userIdType") === "" && !!factTable?.userIdTypes?.[0]) {
    form.setValue("userIdType", factTable.userIdTypes[0]);
  }

  const metricAnalysis = data?.metricAnalysis;
  const hasQueries = (metricAnalysis?.queries ?? []).length > 0;

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

  const datasource = factMetric.datasource
    ? getDatasourceById(factMetric.datasource)
    : null;

  const formatter = getExperimentMetricFormatter(factMetric, getFactTableById);

  const numeratorFormatter = getColumnRefFormatter(factMetric.numerator, getFactTableById)
  const denominatorFormatter = factMetric.denominator ? getColumnRefFormatter(factMetric.denominator, getFactTableById) : undefined;
  const canRunMetricQuery =
    datasource && permissionsUtil.canRunMetricQueries(datasource);
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
          projects={factMetric.projects}
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

      {!!datasource && (
        <div className="mb-4">
          <h3>Metric Analysis</h3>
          <div className="appbox p-3 mb-3">
            <div className="row mb-3 align-items-center">
              <div className="col-auto form-inline pr-5">
                <div>
                  <div className="uppercase-title text-muted">Date Range</div>
                  <div className="row">
                    <div className="col-auto">
                  <SelectField
                    containerClassName={"select-dropdown-underline"}
                    options={[
                      {
                        label: "Last 7 Days",
                        value: "7",
                      },
                      {
                        label: "Last 14 Days",
                        value: "14",
                      },
                      {
                        label: "Last 30 Days",
                        value: "30",
                      },
                      {
                        label: "Custom Lookback",
                        value: "custom",
                      },
                    ]}
                    sort={false}
                    value={lookbackSelected}
                    onChange={(v) => {
                      setLookbackSelected(v);
                      if (v !== "custom") {
                        form.setValue("lookbackDays", parseInt(v));
                      }
                    }}
                  />
                  </div>
                  {lookbackSelected === "custom" && (
                    <div className="col-auto">
                    <Field
                      type="number"
                      min={1}
                      max={999999}
                      append={"days"}
                      {...form.register("lookbackDays")}
                    />
                  </div>
                  )}
                  </div>
                </div>
              </div>
              <div className="col-auto form-inline pr-5">
                <IdentifierChooser
                  value={form.watch("userIdType")}
                  setValue={(v) => form.setValue("userIdType", v)}
                  factTableId={factMetric.numerator.factTableId}
                />
              </div>
              <div className="col-auto form-inline pr-5">
                <PopulationChooser
                  value={form.watch("populationType")}
                  setValue={(v) =>
                    form.setValue(
                      "populationType",
                      v as MetricAnalysisPopulationType
                    )
                  }
                  setPopulationValue={(v) => form.setValue("populationId", v)}
                  userIdType={form.watch("userIdType")}
                  datasourceId={factMetric.datasource}
                />
              </div>
              <div style={{ flex: 1 }} />
              {hasQueries && (
                <div className="row my-3">
                  <div className="col-auto">
                    <ViewAsyncQueriesButton
                      queries={
                        metricAnalysis?.queries.map((q) => q.query) ?? []
                      }
                      color={
                        metricAnalysis?.status === "error" ? "danger" : "info"
                      }
                      error={metricAnalysis?.error}
                    />
                  </div>
                </div>
              )}
              <div className="col-auto">
                {canRunMetricQuery && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        const today = new Date();
                        const todayMinusLookback = new Date();
                        todayMinusLookback.setDate(
                          todayMinusLookback.getDate() -
                            (form.watch("lookbackDays") as number)
                        );
                        console.log(typeof  form.watch("lookbackDays"))
                        const data: CreateMetricAnalysisProps = {
                          id: factMetric.id,
                          userIdType: form.watch("userIdType"),
                          dimensions: [],
                          lookbackDays: Number(form.watch("lookbackDays")),
                          startDate: todayMinusLookback.toISOString().substring(0, 16),
                          endDate: today.toISOString().substring(0, 16),
                          populationType: form.watch("populationType"),
                          populationId: form.watch("populationId") ?? undefined,
                        };
                        await apiCall(`/metric-analysis`, {
                          method: "POST",
                          body: JSON.stringify(data),
                        });
                        mutate();
                      } catch (e) {
                        console.error(e);
                      }
                    }}
                  >
                    <RunQueriesButton
                      icon="refresh"
                      cta={"Run Analysis"}
                      mutate={mutate}
                      model={
                        metricAnalysis ?? {
                          queries: [],
                          runStarted: new Date(),
                        }
                      }
                      cancelEndpoint={`/metric-analysis/${metricAnalysis?.id}/cancel`}
                      color="outline-primary"
                    />
                  </form>
                )}
              </div>
            </div>

            {/* AVERAGE; N USERS WITH 0 */}
            {metricAnalysis?.result && (
              <MetricAnalysisOverview
                name={factMetric.name}
                metricType={factMetric.metricType}
                userIdType={metricAnalysis.settings.userIdType}
                result={metricAnalysis.result}
                formatter={formatter}
                numeratorFormatter={numeratorFormatter}
                denominatorFormatter={denominatorFormatter}
              />
            )}
            {metricAnalysis?.result?.dates &&
              metricAnalysis.result.dates.length > 0 && (
                <div className="mb-4">

                  <div className="row mt-3">
                    <div className="col-auto">
                      <h4 className="mb-1 mt-1">
                        {factMetric.metricType === "proportion"
                          ? "Conversions"
                          : "Metric Value"}{" "}
                        Over Time
                      </h4>
                    </div>
                  </div>

{factMetric.metricType != "proportion" && (<>
                  <div className="row mt-4 mb-1">
                    <div className="col">
                      <Tooltip
                        body={
                          <>
                            <p>
                              This figure shows the average metric value on a
                              day divided by number of unique units (e.g. users)
                              in the metric source on that day.
                            </p>
                            <p>
                              The standard deviation shows the spread of the
                              daily user metric values.
                            </p>
                            <p>
                              When smoothing is turned on, we simply average
                              values and standard deviations over the 7 trailing
                              days (including the selected day).
                            </p>
                          </>
                        }
                      >
                        <strong className="ml-4 align-bottom">
                          Daily Average <FaQuestionCircle />
                        </strong>
                      </Tooltip>
                    </div>
                    <div className="col">
                      <div className="float-right mr-2">
                        <label
                          className="small my-0 mr-2 text-right align-middle"
                          htmlFor="toggle-group-by-avg"
                        >
                          Smoothing
                          <br />
                          (7 day trailing)
                        </label>
                        <Toggle
                          value={smoothByAvg === "week"}
                          setValue={() =>
                            setSmoothByAvg(
                              smoothByAvg === "week" ? "day" : "week"
                            )
                          }
                          id="toggle-group-by-avg"
                          className="align-middle"
                        />
                      </div>
                    </div>
                  </div>
                  <DateGraph
                    type={"count"}
                    method="avg"
                    dates={metricAnalysis.result.dates.map((d) => {
                      return {
                        d: d.date,
                        v: d.mean,
                        s: d.stddev,
                        c: d.units,
                      };
                    })}
                    smoothBy={smoothByAvg}
                    formatter={formatter}
                    onHover={onHoverCallback}
                    hoverDate={hoverDate}
                  /></>)}

                  {factMetric.metricType !== "ratio" ? (
                    <>
                      <div className="row mt-4 mb-1">
                        <div className="col">
                          <Tooltip
                            body={
                              <>
                                {factMetric.metricType !== "proportion" ? (
                                  <>
                                    <p>
                                      This figure shows the daily sum of values
                                      in the metric source on that day.
                                    </p>
                                    <p>
                                      When smoothing is turned on, we simply
                                      average values over the 7 trailing days
                                      (including the selected day).
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <p>
                                      This figure shows the total count of units
                                      (e.g. users) in the metric source on that
                                      day.
                                    </p>
                                    <p>
                                      When smoothing is turned on, we simply
                                      average counts over the 7 trailing days
                                      (including the selected day).
                                    </p>
                                  </>
                                )}
                              </>
                            }
                          >
                            <strong className="ml-4 align-bottom">
                              Daily{" "}
                              {factMetric.metricType !== "proportion"
                                ? "Sum"
                                : "Count"}{" "}
                              <FaQuestionCircle />
                            </strong>
                          </Tooltip>
                        </div>
                        <div className="col">
                          <div className="float-right mr-2">
                            <label
                              className="small my-0 mr-2 text-right align-middle"
                              htmlFor="toggle-group-by-sum"
                            >
                              Smoothing
                              <br />
                              (7 day trailing)
                            </label>
                            <Toggle
                              value={smoothBySum === "week"}
                              setValue={() =>
                                setSmoothBySum(
                                  smoothBySum === "week" ? "day" : "week"
                                )
                              }
                              id="toggle-group-by-sum"
                              className="align-middle"
                            />
                          </div>
                        </div>
                      </div>
                      <DateGraph
                        type={
                          factMetric.metricType === "proportion"
                            ? "binomial"
                            : "count"
                        }
                        method="sum"
                        dates={metricAnalysis.result.dates.map((d) => {
                          return {
                            d: d.date,
                            v: d.mean,
                            s: d.stddev,
                            c: d.units,
                            num: d.numerator,
                            den: d.denominator,
                          };
                        })}
                        smoothBy={smoothBySum}
                        formatter={formatter}
                        onHover={onHoverCallback}
                        hoverDate={hoverDate}
                      />
                    </>
                  ) : null}
                </div>
              )}
            {metricAnalysis?.result?.histogram &&
              metricAnalysis.result.histogram.length > 0 &&
              factMetric.metricType !== "proportion" && (
                <div className="mb-4">
                  <div className="row mt-3">
                    <div className="col-auto">
                      <h4 className="mb-1 mt-1">
                        Histogram of Metric value by{" "}
                        <code>{metricAnalysis.settings.userIdType}</code> Totals
                      </h4>
                    </div>
                  </div>
                  <HistogramGraph
                    data={metricAnalysis.result.histogram}
                    userIdType={metricAnalysis.settings.userIdType}
                    formatter={formatter}
                  />
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
