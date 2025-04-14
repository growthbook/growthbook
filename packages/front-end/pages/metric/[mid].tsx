import { useRouter } from "next/router";
import React, {
  FC,
  useState,
  useEffect,
  Fragment,
  ReactNode,
  ReactElement,
} from "react";
import Link from "next/link";
import { FaArchive, FaQuestionCircle, FaTimes } from "react-icons/fa";
import { MetricInterface } from "back-end/types/metric";
import { useForm } from "react-hook-form";
import { BsGear } from "react-icons/bs";
import { IdeaInterface } from "back-end/types/idea";
import { date } from "shared/dates";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import {
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import DiscussionThread from "@/components/DiscussionThread";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import LoadingOverlay from "@/components/LoadingOverlay";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import { getMetricFormatter } from "@/services/metrics";
import MetricForm, { usesValueColumn } from "@/components/Metrics/MetricForm";
import Tabs from "@/components/Tabs/Tabs";
import Tab from "@/components/Tabs/Tab";
import HistoryTable from "@/components/HistoryTable";
import DateGraph from "@/components/Metrics/DateGraph";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import RightRailSection from "@/components/Layout/RightRailSection";
import RightRailSectionGroup from "@/components/Layout/RightRailSectionGroup";
import InlineForm from "@/components/Forms/InlineForm";
import EditableH1 from "@/components/Forms/EditableH1";
import { useDefinitions } from "@/services/DefinitionsContext";
import Code from "@/components/SyntaxHighlighting/Code";
import PickSegmentModal from "@/components/Segments/PickSegmentModal";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Button from "@/components/Button";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import ProjectBadges from "@/components/ProjectBadges";
import EditProjectsForm from "@/components/Projects/EditProjectsForm";
import { GBCuped, GBEdit } from "@/components/Icons";
import Toggle from "@/components/Forms/Toggle";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useCurrency } from "@/hooks/useCurrency";
import { DeleteDemoDatasourceButton } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import { capitalizeFirstLetter } from "@/services/utils";
import MetricName from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MetricPriorRightRailSectionGroup from "@/components/Metrics/MetricPriorRightRailSectionGroup";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import MetricExperiments from "@/components/MetricExperiments/MetricExperiments";

const MetricPage: FC = () => {
  const router = useRouter();
  const { mid } = router.query;
  const permissionsUtil = usePermissionsUtil();
  const displayCurrency = useCurrency();
  const { apiCall } = useAuth();
  const {
    mutateDefinitions,
    getDatasourceById,
    getSegmentById,
    getMetricById,
    metrics,
    segments,
  } = useDefinitions();
  const settings = useOrgSettings();
  const { organization } = useUser();

  const [editModalOpen, setEditModalOpen] = useState<boolean | number>(false);
  const [editing, setEditing] = useState(false);
  const [editTags, setEditTags] = useState(false);
  const [editProjects, setEditProjects] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);
  const [segmentOpen, setSegmentOpen] = useState(false);
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

  const { data, error, mutate } = useApi<{
    metric: MetricInterface;
  }>(`/metric/${mid}`);

  const {
    metricDefaults,
    getMinSampleSizeForMetric,
    getMinPercentageChangeForMetric,
    getMaxPercentageChangeForMetric,
  } = useOrganizationMetricDefaults();

  const form = useForm<{ name: string; description: string }>();

  useEffect(() => {
    if (data?.metric) {
      form.setValue("name", data.metric.name || "");
      form.setValue("description", data.metric.description || "");
    }
  }, [data]);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const metric = data.metric;
  const canEditMetric =
    permissionsUtil.canUpdateMetric(metric, {}) && !metric.managedBy;
  const canDeleteMetric =
    permissionsUtil.canDeleteMetric(metric) && !metric.managedBy;
  const datasource = metric.datasource
    ? getDatasourceById(metric.datasource)
    : null;
  const canRunMetricQuery =
    datasource && permissionsUtil.canRunMetricQueries(datasource);

  let analysis = data.metric.analysis || null;
  if (!analysis || !("average" in analysis)) {
    analysis = null;
  }

  const segment = getSegmentById(metric.segment || "");

  const supportsSQL = datasource?.properties?.queryLanguage === "sql";
  const customzeTimestamp = supportsSQL;
  const customizeUserIds = supportsSQL;

  const { status } = getQueryStatus(metric.queries || [], metric.analysisError);
  const hasQueries = metric.queries?.length > 0;

  let regressionAdjustmentAvailableForMetric = true;
  let regressionAdjustmentAvailableForMetricReason = <></>;
  const denominator = metric.denominator
    ? metrics.find((m) => m.id === metric.denominator)
    : undefined;
  if (denominator && denominator.type === "count") {
    regressionAdjustmentAvailableForMetric = false;
    regressionAdjustmentAvailableForMetricReason = (
      <>
        对于分母为 <em>计数</em> 类型的比率指标，回归调整不可用。
      </>
    );
  }
  if (metric.aggregation) {
    regressionAdjustmentAvailableForMetric = false;
    regressionAdjustmentAvailableForMetricReason = (
      <>对于使用自定义聚合的指标，回归调整不可用。</>
    );
  }

  const variables = {
    metricName: metric.name,
    tags: metric.tags || [],
    metricType: metric.type,
    metricDatasource: datasource?.name || "",
  };

  const getMetricUsage = (metric: MetricInterface) => {
    return async (): Promise<ReactElement | null> => {
      try {
        const res = await apiCall<{
          status: number;
          ideas?: IdeaInterface[];
          experiments?: { name: string; id: string }[];
        }>(`/metric/${metric.id}/usage`, {
          method: "GET",
        });

        const experimentLinks: (string | ReactNode)[] = [];
        const ideaLinks: (string | ReactNode)[] = [];
        let subtitleText = "此指标未在其他地方被引用。";
        if (res.ideas?.length || res.experiments?.length) {
          subtitleText = "此指标在以下地方被引用：";
          const refs = [];
          if (res.experiments && res.experiments.length) {
            refs.push(
              res.experiments.length === 1
                ? "1 个实验"
                : res.experiments.length + " 个实验"
            );
            res.experiments.forEach((e) => {
              experimentLinks.push(
                <Link href={`/experiment/${e.id}`}>{e.name}</Link>
              );
            });
          }
          if (res.ideas && res.ideas.length) {
            refs.push(
              res.ideas.length === 1 ? "1 个想法" : res.ideas.length + " 个想法"
            );
            res.ideas.forEach((i) => {
              ideaLinks.push(<Link href={`/idea/${i.id}`}>{i.text}</Link>);
            });
          }
          subtitleText += refs.join(" 和 ");

          return (
            <div>
              <p>{subtitleText}</p>
              {(experimentLinks.length > 0 || ideaLinks.length > 0) && (
                <>
                  <div
                    className="row mx-1 mb-2 mt-1 py-2"
                    style={{ fontSize: "0.8rem" }}
                  >
                    {experimentLinks.length > 0 && (
                      <div className="col-6 text-smaller text-left">
                        实验:{" "}
                        <ul className="mb-0 pl-3">
                          {experimentLinks.map((l, i) => {
                            return (
                              <Fragment key={i}>
                                <li>{l}</li>
                              </Fragment>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {ideaLinks.length > 0 && (
                      <div className="col-6 text-smaller text-left">
                        想法:{" "}
                        <ul className="mb-0 pl-3">
                          {ideaLinks.map((l, i) => {
                            return (
                              <Fragment key={i}>
                                <li>{l}</li>
                              </Fragment>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                  <p className="mb-0">
                    删除该指标将移除这些引用.
                  </p>
                </>
              )}
              <p>此删除操作不可撤销。</p>
              <p>
                如果你希望保留现有引用，但防止此指标在未来被使用，你可以将此指标归档。
              </p>
            </div>
          );
        }
      } catch (e) {
        console.error(e);
        return (
          <div className="alert alert-danger">
            发生错误
          </div>
        );
      }
      return null;
    };
  };

  return (
    <div className="container-fluid pagecontents">
      {editModalOpen !== false && (
        <MetricForm
          current={metric}
          edit={true}
          source="metrics-detail"
          initialStep={editModalOpen !== true ? editModalOpen : 0}
          onClose={() => {
            setEditModalOpen(false);
          }}
          onSuccess={() => {
            mutate();
          }}
        />
      )}
      {editTags && (
        <EditTagsForm
          cancel={() => setEditTags(false)}
          mutate={mutate}
          tags={metric.tags || []}
          save={async (tags) => {
            await apiCall(`/metric/${metric.id}`, {
              method: "PUT",
              body: JSON.stringify({
                tags,
              }),
            });
          }}
          source="mid"
        />
      )}
      {editProjects && (
        <EditProjectsForm
          label={
            <>
              项目{" "}
              <Tooltip
                body={
                  "以下下拉菜单已过滤，仅包含你有权限更新指标的项目"
                }
              />
            </>
          }
          cancel={() => setEditProjects(false)}
          entityName="Metric"
          mutate={mutate}
          value={metric.projects || []}
          permissionRequired={(project) =>
            permissionsUtil.canUpdateMetric({ projects: [project] }, {})
          }
          save={async (projects) => {
            await apiCall(`/metric/${metric.id}`, {
              method: "PUT",
              body: JSON.stringify({
                projects,
              }),
            });
          }}
        />
      )}
      {editOwnerModal && (
        <EditOwnerModal
          cancel={() => setEditOwnerModal(false)}
          owner={metric.owner}
          save={async (owner) => {
            await apiCall(`/metric/${metric.id}`, {
              method: "PUT",
              body: JSON.stringify({ owner }),
            });
          }}
          mutate={mutate}
        />
      )}
      {segmentOpen && (
        <PickSegmentModal
          close={() => setSegmentOpen(false)}
          datasource={metric.datasource || ""}
          save={async (s) => {
            // Update the segment
            await apiCall(`/metric/${metric.id}`, {
              method: "PUT",
              body: JSON.stringify({
                segment: s || "",
              }),
            });
            // Run the analysis with the new segment
            await apiCall(`/metric/${metric.id}/analysis`, {
              method: "POST",
            });
            mutateDefinitions({});
            mutate();
          }}
          segment={metric.segment || ""}
        />
      )}

      <PageHead
        breadcrumb={[
          { display: "指标", href: "/metrics" },
          { display: metric.name },
        ]}
      />

      {metric.status === "archived" && (
        <div className="alert alert-secondary mb-2">
          <strong>此指标已归档。</strong> 现有引用将继续生效，但你将无法将此指标添加到新实验中。
        </div>
      )}

      {metric.projects?.includes(
        getDemoDatasourceProjectIdForOrganization(organization.id)
      ) && (
          <div className="alert alert-info mb-3 d-flex align-items-center mt-3">
            <div className="flex-1">
              此指标是我们示例数据集的一部分。你完成探索后可以安全删除。
            </div>
            <div style={{ width: 180 }} className="ml-2">
              <DeleteDemoDatasourceButton
                onDelete={() => router.push("/metrics")}
                source="metric"
              />
            </div>
          </div>
        )}

      <div className="row align-items-center mb-2">
        <h1 className="col-auto">
          <MetricName id={metric.id} />
        </h1>
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          <MoreMenu>
            {canDeleteMetric ? (
              <DeleteButton
                className="btn dropdown-item py-2"
                text="删除"
                title="删除该指标"
                getConfirmationContent={getMetricUsage(metric)}
                onClick={async () => {
                  await apiCall(`/metric/${metric.id}`, {
                    method: "DELETE",
                  });
                  mutateDefinitions({});
                  router.push("/metrics");
                }}
                useIcon={true}
                displayName={"指标 '" + metric.name + "'"}
              />
            ) : null}
            {canEditMetric ? (
              <Button
                className="btn dropdown-item py-2"
                color=""
                onClick={async () => {
                  const newStatus =
                    metric.status === "archived" ? "active" : "archived";
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
                {metric.status === "archived" ? "取消归档" : "归档"}
              </Button>
            ) : null}
          </MoreMenu>
        </div>
      </div>
      <div className="row mb-3 align-items-center">
        <div className="col">
          项目:{" "}
          {metric?.projects?.length ? (
            <ProjectBadges
              resourceType="metric"
              projectIds={metric.projects}
              className="badge-ellipsis align-middle"
            />
          ) : (
            <ProjectBadges
              resourceType="metric"
              className="badge-ellipsis align-middle"
            />
          )}
          {canEditMetric && (
            <a
              href="#"
              className="ml-2"
              onClick={(e) => {
                e.preventDefault();
                setEditProjects(true);
              }}
            >
              <GBEdit />
            </a>
          )}
        </div>
      </div>

      <div className="mt-3">
        <CustomMarkdown page={"metric"} variables={variables} />
      </div>

      <div className="row">
        <div className="col-12 col-md-8">
          <Tabs newStyle={true}>
            <Tab display="信息" anchor="info" lazy={true}>
              <div className="row">
                <div className="col-12">
                  <InlineForm
                    editing={editing}
                    setEdit={setEditing}
                    canEdit={canEditMetric}
                    onSave={form.handleSubmit(async (value) => {
                      await apiCall(`/metric/${metric.id}`, {
                        method: "PUT",
                        body: JSON.stringify(value),
                      });
                      await mutate();
                      mutateDefinitions({});
                      setEditing(false);
                    })}
                    onStartEdit={() => {
                      form.setValue("name", metric.name || "");
                      form.setValue("description", metric.description || "");
                    }}
                  >
                    {({ cancel, save }) => (
                      <div className="mb-4">
                        <div className="row mb-3">
                          <div className="col">
                            <EditableH1
                              value={form.watch("name")}
                              onChange={(e) =>
                                form.setValue("name", e.target.value)
                              }
                              editing={canEditMetric && editing}
                              save={save}
                              cancel={cancel}
                            />
                          </div>
                          {canEditMetric && !editing && (
                            <div className="col-auto">
                              <button
                                className="btn btn-outline-primary"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setEditing(true);
                                }}
                              >
                                编辑
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </InlineForm>
                  <MarkdownInlineEdit
                    save={async (description) => {
                      await apiCall(`/metric/${metric.id}`, {
                        method: "PUT",
                        body: JSON.stringify({
                          description,
                        }),
                      });
                      await mutate();
                      mutateDefinitions({});
                    }}
                    value={metric.description}
                    canCreate={canEditMetric}
                    canEdit={canEditMetric}
                    label="描述"
                  />
                  <hr />
                  {!!datasource && (
                    <div>
                      <div className="row mb-1 align-items-center">
                        <div className="col-auto">
                          <h3 className="d-inline-block mb-0">数据预览</h3>
                        </div>
                        <div className="small col-auto">
                          {segments.length > 0 && (
                            <>
                              {segment?.name ? (
                                <>
                                  已应用分段:{" "}
                                  <span className="badge badge-primary mr-1">
                                    {segment?.name || "Everyone"}
                                  </span>
                                </>
                              ) : (
                                <span className="mr-1">应用分段</span>
                              )}
                              {canEditMetric && canRunMetricQuery && (
                                <a
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setSegmentOpen(true);
                                  }}
                                  href="#"
                                >
                                  <BsGear />
                                </a>
                              )}
                            </>
                          )}
                        </div>
                        <div style={{ flex: 1 }} />
                        <div className="col-auto">
                          {canRunMetricQuery && (
                            <form
                              onSubmit={async (e) => {
                                e.preventDefault();
                                try {
                                  await apiCall(
                                    `/metric/${metric.id}/analysis`,
                                    {
                                      method: "POST",
                                    }
                                  );
                                  mutate();
                                } catch (e) {
                                  console.error(e);
                                }
                              }}
                            >
                              <RunQueriesButton
                                icon="refresh"
                                cta={analysis ? "更新数据" : "运行分析"}
                                mutate={mutate}
                                model={metric}
                                cancelEndpoint={`/metric/${metric.id}/analysis/cancel`}
                                color="outline-primary"
                              />
                            </form>
                          )}
                        </div>
                      </div>
                      <div className="row flex justify-content-between">
                        <div className="small text-muted col">
                          {denominator && (
                            <>
                              以下数据仅聚合了分子。分母 ({denominator.name}) 仅用于实验分析。
                            </>
                          )}
                        </div>
                        {analysis && (
                          <div className="small text-muted col-auto">
                            最近修改于 {date(analysis?.createdAt)}
                          </div>
                        )}
                      </div>
                      {hasQueries && status === "failed" && (
                        <div className="alert alert-danger my-3">
                          执行分析出错.{" "}
                          <ViewAsyncQueriesButton
                            queries={metric.queries.map((q) => q.query)}
                            error={metric.analysisError}
                            ctaComponent={(onClick) => (
                              <a
                                className="alert-link"
                                href="#"
                                onClick={onClick}
                              >
                                查看查询结果
                              </a>
                            )}
                          />{" "}
                          查看更多信息
                        </div>
                      )}
                      {hasQueries && status === "running" && (
                        <div className="alert alert-info">
                          您的分析正在运行{" "}
                          {analysis &&
                            "以下数据来自上一次运行。"}
                        </div>
                      )}
                      {analysis &&
                        status === "succeeded" &&
                        (metric.segment || analysis.segment) &&
                        metric.segment !== analysis.segment && (
                          <div className="alert alert-info">
                            以下图表使用的是旧的分段。更新它们以查看最新数据。
                          </div>
                        )}
                      {analysis && (
                        <div className="mb-4">
                          {metric.type !== "binomial" && (
                            <div className="d-flex flex-row align-items-end">
                              <div style={{ fontSize: "2.5em" }}>
                                {getMetricFormatter(metric.type)(
                                  analysis.average,
                                  {
                                    currency: displayCurrency,
                                  }
                                )}
                              </div>
                              <div className="pb-2 ml-1">平均值</div>
                            </div>
                          )}
                        </div>
                      )}
                      {analysis?.dates && analysis.dates.length > 0 && (
                        <div className="mb-4">
                          <div className="row mt-3">
                            <div className="col-auto">
                              <h5 className="mb-1 mt-1">
                                {metric.type === "binomial"
                                  ? "转化率"
                                  : "指标值"} {"随时间变化"}
                              </h5>
                            </div>
                          </div>

                          {metric.type !== "binomial" && (
                            <>
                              <div className="row mt-4 mb-1">
                                <div className="col">
                                  <Tooltip
                                    body={
                                      <>
                                        <p>
                                          此图显示了一天内的平均指标值除以该天指标源中的唯一单位（例如用户）数量。
                                        </p>
                                        <p>
                                          标准差显示了每日用户指标值的分布情况。
                                        </p>
                                        <p>
                                          开启平滑后，我们会对过去 7 天（包括所选日期）的值和标准差进行平均。
                                        </p>
                                      </>
                                    }
                                  >
                                    <strong className="ml-4 align-bottom">
                                      日平均 <FaQuestionCircle />
                                    </strong>
                                  </Tooltip>
                                </div>
                                <div className="col">
                                  <div className="float-right mr-2">
                                    <label
                                      className="small my-0 mr-2 text-right align-middle"
                                      htmlFor="toggle-group-by-avg"
                                    >
                                      平滑
                                      <br />
                                      (过去 7 天)
                                    </label>
                                    <Toggle
                                      value={smoothByAvg === "week"}
                                      setValue={() =>
                                        setSmoothByAvg(
                                          smoothByAvg === "week"
                                            ? "day"
                                            : "week"
                                        )
                                      }
                                      id="toggle-group-by-avg"
                                      className="align-middle"
                                    />
                                  </div>
                                </div>
                              </div>
                              <DateGraph
                                type={metric.type}
                                method="avg"
                                dates={analysis.dates}
                                smoothBy={smoothByAvg}
                                onHover={onHoverCallback}
                                hoverDate={hoverDate}
                              />
                            </>
                          )}

                          <div className="row mt-4 mb-1">
                            <div className="col">
                              <Tooltip
                                body={
                                  <>
                                    {metric.type !== "binomial" ? (
                                      <>
                                        <p>
                                          此图显示了该天指标源中值的每日总和。
                                        </p>
                                        <p>
                                          开启平滑后，我们会对过去 7 天（包括所选日期）的值进行平均。
                                        </p>
                                      </>
                                    ) : (
                                      <>
                                        <p>
                                          此图显示了该天指标源中单位（例如用户）的总数。
                                        </p>
                                        <p>
                                          开启平滑后，我们会对过去 7 天（包括所选日期）的计数进行平均。
                                        </p>
                                      </>
                                    )}
                                  </>
                                }
                              >
                                <strong className="ml-4 align-bottom">
                                  每日{" "}
                                  {metric.type !== "binomial" ? "总和" : "计数"}{" "}
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
                                  平滑
                                  <br />
                                  (过去 7 天)
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
                            type={metric.type}
                            method="sum"
                            dates={analysis.dates}
                            smoothBy={smoothBySum}
                            onHover={onHoverCallback}
                            hoverDate={hoverDate}
                          />
                        </div>
                      )}

                      {!analysis && (
                        <div>
                          <em>
                            该指标暂无数据.{" "}
                            {canRunMetricQuery
                              ? "点击上方的运行分析按钮。"
                              : null}
                          </em>
                        </div>
                      )}

                      {hasQueries && (
                        <div className="row my-3">
                          <div className="col-auto">
                            <ViewAsyncQueriesButton
                              queries={metric.queries.map((q) => q.query)}
                              color={status === "failed" ? "danger" : "info"}
                              error={metric.analysisError}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Tab>
            <Tab display="实验" anchor="experiments">
              <h3>实验</h3>
              <MetricExperiments metric={metric} outerClassName="" />
            </Tab>
            <Tab display="讨论" anchor="discussion" lazy={true}>
              <h3>评论</h3>
              <DiscussionThread
                type="metric"
                id={data.metric.id}
                projects={metric.projects || []}
              />
            </Tab>
            <Tab display="历史" anchor="history" lazy={true}>
              <HistoryTable type="metric" id={metric.id} />
            </Tab>
          </Tabs>
        </div>
        <div className="col-12 col-md-4 mt-md-5">
          <div className="appbox p-3" style={{ marginTop: "7px" }}>
            <RightRailSection
              title="负责人"
              open={() => setEditOwnerModal(true)}
              canOpen={canEditMetric}
            >
              <RightRailSectionGroup type="custom">
                {metric.owner}
              </RightRailSectionGroup>
            </RightRailSection>

            <hr />
            <RightRailSection
              title="基础信息"
              open={() => setEditModalOpen(0)}
              canOpen={canEditMetric}
            >
              <RightRailSectionGroup title="类型" type="commaList">
                {metric.type}
              </RightRailSectionGroup>
              {datasource && (
                <RightRailSectionGroup
                  title="数据来源"
                  type="commaList"
                  titleClassName="align-top"
                >
                  <div className="d-inline-block" style={{ maxWidth: 280 }}>
                    <div>
                      <Link href={`/datasources/${datasource?.id}`}>
                        {datasource.name}
                      </Link>
                    </div>
                    <div className="text-gray font-weight-normal small text-ellipsis">
                      {datasource?.description}
                    </div>
                  </div>
                </RightRailSectionGroup>
              )}
              {datasource?.type === "google_analytics" && (
                <RightRailSectionGroup title="GA Metric" type="commaList">
                  {metric.table}
                </RightRailSectionGroup>
              )}
            </RightRailSection>

            <hr />
            <RightRailSection
              title="标签"
              open={() => setEditTags(true)}
              canOpen={canEditMetric}
            >
              <RightRailSectionGroup type="tags">
                {metric.tags}
              </RightRailSectionGroup>
            </RightRailSection>

            <hr />
            <RightRailSection
              title="项目"
              open={() => setEditProjects(true)}
              canOpen={canEditMetric}
            >
              <RightRailSectionGroup>
                {metric?.projects?.length ? (
                  <ProjectBadges
                    resourceType="metric"
                    projectIds={metric.projects}
                    className="badge-ellipsis align-middle"
                  />
                ) : (
                  <ProjectBadges
                    resourceType="metric"
                    className="badge-ellipsis align-middle"
                  />
                )}
              </RightRailSectionGroup>
            </RightRailSection>

            {datasource?.properties?.hasSettings && (
              <>
                <hr />
                <RightRailSection
                  title="查询设置"
                  open={() => setEditModalOpen(1)}
                  canOpen={canEditMetric}
                >
                  {supportsSQL &&
                    metric.queryFormat !== "builder" &&
                    metric.sql ? (
                    <>
                      {metric.userIdTypes && customizeUserIds && (
                        <RightRailSectionGroup
                          title="标识符类型"
                          type="commaList"
                        >
                          {metric.userIdTypes}
                        </RightRailSectionGroup>
                      )}
                      {metric.templateVariables?.eventName && (
                        <RightRailSectionGroup title="事件名称" type="custom">
                          <span className="font-weight-bold">
                            {metric.templateVariables.eventName}
                          </span>
                        </RightRailSectionGroup>
                      )}
                      {metric.type != "binomial" &&
                        metric.templateVariables?.valueColumn &&
                        usesValueColumn(metric.sql) && (
                          <RightRailSectionGroup
                            title="值列"
                            type="custom"
                          >
                            <span className="font-weight-bold">
                              {metric.templateVariables.valueColumn}
                            </span>
                          </RightRailSectionGroup>
                        )}
                      <RightRailSectionGroup title="指标SQL" type="custom">
                        <Code language="sql" code={metric.sql} />
                      </RightRailSectionGroup>
                      {metric.type !== "binomial" && metric.aggregation && (
                        <RightRailSectionGroup
                          title="用户值聚合"
                          type="custom"
                        >
                          <Code language="sql" code={metric.aggregation} />
                        </RightRailSectionGroup>
                      )}
                      <RightRailSectionGroup title="分母" type="custom">
                        <strong>
                          {metric.denominator ? (
                            <Link href={`/metric/${metric.denominator}`}>
                              {getMetricById(metric.denominator)?.name ||
                                "未知"}
                            </Link>
                          ) : (
                            "所有实验用户"
                          )}
                        </strong>
                      </RightRailSectionGroup>
                    </>
                  ) : (
                    <>
                      <RightRailSectionGroup
                        title={supportsSQL ? "表名" : "事件名称"}
                        type="code"
                      >
                        {metric.table}
                      </RightRailSectionGroup>
                      {metric.conditions && metric.conditions.length > 0 && (
                        <RightRailSectionGroup title="条件" type="list">
                          {metric.conditions.map(
                            (c) => `${c.column} ${c.operator} "${c.value}"`
                          )}
                        </RightRailSectionGroup>
                      )}
                      {metric.type !== "binomial" &&
                        metric.column &&
                        supportsSQL && (
                          <RightRailSectionGroup title="列" type="code">
                            {metric.column}
                          </RightRailSectionGroup>
                        )}
                      {metric.type !== "binomial" &&
                        metric.column &&
                        !supportsSQL && (
                          <div className="mt-2">
                            <span className="text-muted">
                              事件值表达式
                            </span>
                            <Code language="javascript" code={metric.column} />
                          </div>
                        )}
                      {metric.type !== "binomial" &&
                        metric.aggregation &&
                        !supportsSQL && (
                          <div className="mt-2">
                            <span className="text-muted">
                              用户值聚合:
                            </span>
                            <Code
                              language="javascript"
                              code={metric.aggregation}
                            />
                          </div>
                        )}
                      {customzeTimestamp && (
                        <RightRailSectionGroup
                          title="时间戳列"
                          type="code"
                        >
                          {metric.timestampColumn}
                        </RightRailSectionGroup>
                      )}
                      {metric.userIdTypes && customizeUserIds && (
                        <RightRailSectionGroup
                          title="标识符列"
                          type="custom"
                        >
                          <ul>
                            {metric.userIdTypes?.map((type) => (
                              <li key={type}>
                                <strong>{type}</strong>:{" "}
                                {metric.userIdColumns?.[type] || type}
                              </li>
                            ))}
                          </ul>
                        </RightRailSectionGroup>
                      )}
                    </>
                  )}
                </RightRailSection>
              </>
            )}

            <hr />
            <RightRailSection
              title="行为"
              open={() => setEditModalOpen(2)}
              canOpen={canEditMetric}
            >
              <RightRailSectionGroup type="custom" empty="" className="mt-3">
                <ul className="right-rail-subsection list-unstyled mb-4">
                  {metric.inverse && (
                    <li className="mb-2">
                      <span className="text-gray">目标:</span>{" "}
                      <span className="font-weight-bold">取反</span>
                    </li>
                  )}
                  {metric.cappingSettings.type && metric.cappingSettings.value && (
                    <>
                      <li className="mb-2">
                        <span className="uppercase-title lg">
                          {capitalizeFirstLetter(metric.cappingSettings.type)}
                          {" 封顶"}
                        </span>
                      </li>
                      <li>
                        <span className="font-weight-bold">
                          {metric.cappingSettings.value}
                        </span>{" "}
                        {metric.cappingSettings.type === "percentile" ? (
                          <span className="text-gray">{`(${100 * metric.cappingSettings.value
                            } 百分位数${metric.cappingSettings.ignoreZeros
                              ? ", 忽略零值"
                              : ""
                            })`}</span>
                        ) : (
                          ""
                        )}{" "}
                      </li>
                    </>
                  )}
                  {metric.ignoreNulls && (
                    <li className="mb-2">
                      <span className="text-gray">仅已转化用户:</span>{" "}
                      <span className="font-weight-bold">是</span>
                    </li>
                  )}
                </ul>
              </RightRailSectionGroup>

              <RightRailSectionGroup type="custom" empty="">
                <ul className="right-rail-subsection list-unstyled mb-4">
                  <li className="mt-3 mb-1">
                    <span className="uppercase-title lg">指标窗口</span>
                  </li>
                  {metric.windowSettings.type === "conversion" ? (
                    <>
                      <li>
                        <span className="font-weight-bold">
                          转化窗口
                        </span>
                      </li>
                      <li>
                        <span className="text-gray">
                          {`要求转化在首次实验曝光后的 `}
                        </span>
                        <strong>
                          {metric.windowSettings.windowValue}{" "}
                          {metric.windowSettings.windowUnit}
                        </strong>
                        <span className="text-gray">{` 
                        内发生${metric.windowSettings.delayHours
                            ? " 加上转化延迟"
                            : ""
                          }`}</span>
                      </li>
                    </>
                  ) : metric.windowSettings.type === "lookback" ? (
                    <>
                      <li>
                        <span className="font-weight-bold">
                          回溯窗口
                        </span>
                      </li>
                      <li>
                        <span className="text-gray">{`要求指标数据在实验的最新 `}</span>
                        <strong>
                          {metric.windowSettings.windowValue}{" "}
                          {metric.windowSettings.windowUnit}
                        </strong>
                        <span className="text-gray"> of the experiment</span>
                      </li>
                    </>
                  ) : (
                    <>
                      <li>
                        <span className="font-weight-bold">禁用</span>
                      </li>
                      <li>
                        <span className="text-gray">{`包括首次实验曝光后的所有指标数据
                      ${metric.windowSettings.delayHours
                            ? " 加上转化延迟"
                            : ""
                          }`}</span>
                      </li>
                    </>
                  )}
                  {metric.windowSettings.delayHours ? (
                    <>
                      <li className="mt-3 mb-1">
                        <span className="uppercase-title lg">指标延迟</span>
                      </li>
                      <li className="mt-1">
                        <span className="font-weight-bold">
                          {metric.windowSettings.delayHours} 小时
                        </span>
                      </li>
                    </>
                  ) : null}
                </ul>
              </RightRailSectionGroup>

              <RightRailSectionGroup type="custom" empty="">
                <ul className="right-rail-subsection list-unstyled mb-4">
                  <li className="mt-3 mb-1">
                    <span className="uppercase-title lg">阈值</span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">最小样本量:</span>{" "}
                    <span className="font-weight-bold">
                      {getMinSampleSizeForMetric(metric)}
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">最大百分比变化:</span>{" "}
                    <span className="font-weight-bold">
                      {getMaxPercentageChangeForMetric(metric) * 100}%
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">最小百分比变化 :</span>{" "}
                    <span className="font-weight-bold">
                      {getMinPercentageChangeForMetric(metric) * 100}%
                    </span>
                  </li>
                </ul>
              </RightRailSectionGroup>

              <RightRailSectionGroup type="custom" empty="">
                <ul className="right-rail-subsection list-unstyled mb-4">
                  <li className="mt-3 mb-2">
                    <span className="uppercase-title lg">风险阈值</span>
                    <small className="d-block mb-1 text-muted">
                      仅适用于贝叶斯分析
                    </small>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">可接受风险 &lt;</span>{" "}
                    <span className="font-weight-bold">
                      {(metric.winRisk || DEFAULT_WIN_RISK_THRESHOLD) * 100}%
                    </span>
                  </li>
                  <li className="mb-2">
                    <span className="text-gray">不可接受风险 &gt;</span>{" "}
                    <span className="font-weight-bold">
                      {(metric.loseRisk || DEFAULT_LOSE_RISK_THRESHOLD) * 100}%
                    </span>
                  </li>
                </ul>
              </RightRailSectionGroup>

              <MetricPriorRightRailSectionGroup
                metric={metric}
                metricDefaults={metricDefaults}
              />

              {/* <RightRailSectionGroup type="custom" empty="">
                <ul className="right-rail-subsection list-unstyled mb-2">
                  <li className="mt-3 mb-2">
                    <span className="uppercase-title lg">
                      <GBCuped size={14} /> 回归调整（CUPED）
                    </span>
                  </li>
                  {!regressionAdjustmentAvailableForMetric ? (
                    <li className="mb-2">
                      <div className="text-muted small">
                        <FaTimes className="text-danger" />{" "}
                        {regressionAdjustmentAvailableForMetricReason}
                      </div>
                    </li>
                  ) : metric?.regressionAdjustmentOverride ? (
                    <>
                      <li className="mb-2">
                        <span className="text-gray">
                          应用回归调整:
                        </span>{" "}
                        <span className="font-weight-bold">
                          {metric?.regressionAdjustmentEnabled ? "On" : "Off"}
                        </span>
                      </li>
                      <li className="mb-2">
                        <span className="text-gray">
                          回溯期（天数）:
                        </span>{" "}
                        <span className="font-weight-bold">
                          {metric?.regressionAdjustmentDays}
                        </span>
                      </li>
                    </>
                  ) : settings.regressionAdjustmentEnabled ? (
                    <>
                      <li className="mb-1">
                        <div className="mb-1">
                          <em className="text-gray">
                            使用集团默认
                          </em>
                        </div>
                        <div className="ml-2 px-2 border-left">
                          <div className="mb-1 small">
                            <span className="text-gray">
                              应用回归调整:
                            </span>{" "}
                            <span className="font-weight-bold">
                              {settings?.regressionAdjustmentEnabled
                                ? "开启"
                                : "关闭"}
                            </span>
                          </div>
                          <div className="mb-1 small">
                            <span className="text-gray">
                              回溯期（天数）:
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
                        <em className="text-gray">禁用</em>
                      </div>
                    </li>
                  )}
                </ul>
              </RightRailSectionGroup> */}
            </RightRailSection>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MetricPage;
