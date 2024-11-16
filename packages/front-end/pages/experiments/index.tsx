import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RxDesktop } from "react-icons/rx";
import { date, datetime } from "shared/dates";
import Link from "next/link";
import { BsFlag } from "react-icons/bs";
import clsx from "clsx";
import { PiCaretDown, PiShuffle } from "react-icons/pi";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useOrgSettings from "@/hooks/useOrgSettings";
import LoadingOverlay from "@/components/LoadingOverlay";
import { phaseSummary } from "@/services/utils";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import { useAddComputedFields, useSearch } from "@/services/search";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import SortedTags from "@/components/Tags/SortedTags";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";
import ImportExperimentModal from "@/components/Experiment/ImportExperimentModal";
import { useExperiments } from "@/hooks/useExperiments";
import Tooltip from "@/components/Tooltip/Tooltip";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "@/components/Tags/TagsFilter";
import { useWatching } from "@/services/WatchProvider";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import Button from "@/components/Radix/Button";
// import LinkButton from "@/hooks/LinkButton";
import LinkButton from "@/components/Radix/LinkButton";
import Dropdown from "@/components/Dropdown/Dropdown";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";

const NUM_PER_PAGE = 20;

// 将实验日期格式化函数中的英文提示替换为中文
export function experimentDate(exp: ExperimentInterfaceStringDates): string {
  return (
    (exp.archived
      ? exp.dateUpdated
      : exp.status === "running"
        ? exp.phases?.[exp.phases?.length - 1]?.dateStarted
        : exp.status === "stopped"
          ? exp.phases?.[exp.phases?.length - 1]?.dateEnded
          : exp.dateCreated) ?? ""
  );
}

const ExperimentsPage = (): React.ReactElement => {
  // const growthbook = useGrowthBook<AppFeatures>();

  const {
    ready,
    project,
    getExperimentMetricById,
    getProjectById,
    getDatasourceById,
  } = useDefinitions();

  const [tabs, setTabs] = useLocalStorage<string[]>("experiment_tabs", []);

  const {
    experiments: allExperiments,
    error,
    loading,
    hasArchived,
  } = useExperiments(project, tabs.includes("archived"), "standard");

  const tagsFilter = useTagsFilter("experiments");
  const [showMineOnly, setShowMineOnly] = useLocalStorage(
    "showMyExperimentsOnly",
    false
  );
  const [openNewExperimentModal, setOpenNewExperimentModal] = useState(false);
  const [openImportExperimentModal, setOpenImportExperimentModal] = useState(
    false
  );

  const { getUserDisplay, userId } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const settings = useOrgSettings();

  const [currentPage, setCurrentPage] = useState(1);

  const experiments = useAddComputedFields(
    allExperiments,
    (exp) => {
      const projectId = exp.project;
      const projectName = projectId ? getProjectById(projectId)?.name : "";
      const projectIsDeReferenced = projectId && !projectName;

      return {
        ownerName: getUserDisplay(exp.owner, false) || "",
        metricNames: exp.goalMetrics
          .map((m) => getExperimentMetricById(m)?.name)
          .filter(Boolean),
        datasource: getDatasourceById(exp.datasource)?.name || "",
        projectId,
        projectName,
        projectIsDeReferenced,
        tab: exp.archived
          ? "已归档"
          : exp.status === "草稿"
            ? "草稿"
            : exp.status,
        date: experimentDate(exp),
      };
    },
    [getExperimentMetricById, getProjectById, getUserDisplay]
  );

  const { watchedExperiments } = useWatching();

  const filterResults = useCallback(
    (items: typeof experiments) => {
      if (showMineOnly) {
        items = items.filter(
          (item) =>
            item.owner === userId || watchedExperiments.includes(item.id)
        );
      }

      items = filterByTags(items, tagsFilter.tags);

      return items;
    },
    [showMineOnly, userId, tagsFilter.tags, watchedExperiments]
  );

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: experiments,
    localStorageKey: "experiments",
    defaultSortField: "date",
    defaultSortDir: -1,
    updateSearchQueryOnChange: true,
    searchFields: [
      "name^3",
      "trackingKey^2",
      "id",
      "hypothesis^2",
      "description",
      "tags",
      "status",
      "ownerName",
      "metricNames",
      "results",
      "analysis",
    ],
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [];
        if (item.archived) is.push("archived");
        if (item.status === "draft") is.push("draft");
        if (item.status === "running") is.push("running");
        if (item.status === "stopped") is.push("stopped");
        if (item.results === "won") is.push("winner");
        if (item.results === "lost") is.push("loser");
        if (item.results === "inconclusive") is.push("inconclusive");
        if (item.hasVisualChangesets) is.push("visual");
        if (item.hasURLRedirects) is.push("redirect");
        return is;
      },
      has: (item) => {
        const has: string[] = [];
        if (item.project) has.push("有项目");
        if (item.hasVisualChangesets) {
          has.push("有视觉变更", "有视觉变更集");
        }
        if (item.hasURLRedirects) has.push("有URL重定向", "有URL重定向集");
        if (item.linkedFeatures?.length) has.push("有相关特性", "特性");
        if (item.hypothesis?.trim()?.length) has.push("有假设");
        if (item.description?.trim()?.length) has.push("有描述");
        if (item.variations.some((v) => !!v.screenshots?.length)) {
          has.push("有截图");
        }
        if (
          item.status === "stopped" &&
          !item.excludeFromPayload &&
          (item.linkedFeatures?.length ||
            item.hasURLRedirects ||
            item.hasVisualChangesets)
        ) {
          has.push("有推出", "临时推出");
        }
        return has;
      },
      variations: (item) => item.variations.length,
      variation: (item) => item.variations.map((v) => v.name),
      created: (item) => new Date(item.dateCreated),
      updated: (item) => new Date(item.dateUpdated),
      name: (item) => item.name,
      key: (item) => item.trackingKey,
      trackingKey: (item) => item.trackingKey,
      id: (item) => [item.id, item.trackingKey],
      status: (item) => item.status,
      result: (item) =>
        item.status === "已停止" ? item.results || "未完成" : "未完成",
      owner: (item) => [item.owner, item.ownerName],
      tag: (item) => item.tags,
      project: (item) => [item.project, item.projectName],
      feature: (item) => item.linkedFeatures || [],
      datasource: (item) => item.datasource,
      metric: (item) => [
        ...item.metricNames,
        ...getAllMetricIdsFromExperiment(item),
      ],
      goal: (item) => [...item.metricNames, ...item.goalMetrics],
    },
    filterResults,
  });

  const searchTermFilterExplainations = (
    <>
      <p>此搜索字段支持高级语法搜索，包括：</p>
      <ul>
        <li>
          <strong>名称</strong>：实验名称（例如：名称:~首页）
        </li>
        <li>
          <strong>编号</strong>：实验编号（例如：编号:^exp）
        </li>
        <li>
          <strong>状态</strong>：实验状态，可以是“已停止”、“运行中”、“草稿”、“已归档”之一
        </li>
        <li>
          <strong>数据源</strong>：实验数据源
        </li>
        <li>
          <strong>指标</strong>：实验使用指定指标（例如：指标:~收入）
        </li>
        <li>
          <strong>创建者</strong>：实验的创建者（例如：创建者:abby）
        </li>
        <li>
          <strong>标签</strong>：带有此标签的实验
        </li>
        <li>
          <strong>项目</strong>：实验的项目
        </li>
        <li>
          <strong>特性</strong>：实验与指定特性相关联
        </li>
        <li>
          <strong>创建时间</strong>：实验的创建日期，采用UTC时间。输入的日期会被解析，支持大多数格式。
        </li>
      </ul>
      <p>点击查看我们文档中支持的所有语法字段。</p>
    </>
  );

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      counts[item.tab] = counts[item.tab] || 0;
      counts[item.tab]++;
    });
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    return tabs.length
      ? items.filter((item) => tabs.includes(item.tab))
      : items;
  }, [tabs, items]);

  // 如果选择了“所有项目”且某些实验在某个项目中，则显示项目列
  const showProjectColumn = !project && items.some((e) => e.project);

  // 当应用过滤器或切换标签时重置到第1页
  useEffect(() => {
    setCurrentPage(1);
  }, [filtered.length]);

  if (error) {
    return (
      <div className="alert alert-danger">
        发生错误：{error.message}
      </div>
    );
  }
  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  const hasExperiments = experiments.length > 0;

  const canAdd = permissionsUtil.canViewExperimentModal(project);

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  function onToggleTab(tab: string) {
    return () => {
      const newTabs = new Set(tabs);
      if (newTabs.has(tab)) newTabs.delete(tab);
      else newTabs.add(tab);
      setTabs([...newTabs]);
    };
  }

  // const addExperimentDropdownButton = (
  //   <Dropdown
  //     uuid="add-experiment"
  //     className="py-0"
  //     caret={false}
  //     toggle={
  //       < Button icon={< PiCaretDown />} iconPosition="right" >
  //         添加实验
  //       </Button >
  //     }
  //   >
  //     <div style={{ width: 220 }}>
  //       <div
  //         className="d-flex align-items-center cursor-pointer hover-highlight px-3 py-2"
  //         onClick={() => setOpenNewExperimentModal(true)}
  //       >
  //         创建新实验
  //       </div>
  //       <div
  //         className="d-flex align-items-center cursor-pointer hover-highlight px-3 py-2"
  //         onClick={() => setOpenImportExperimentModal(true)}
  //       >
  //         导入现有实验
  //       </div>
  //     </div>
  //   </Dropdown >
  // );

  const showSetupInstructionsButton = false;
  return (
    <>
      <div className="contents experiments container-fluid pagecontents">
        <div className="mb-3">
          <div className="filters md-form row mb-3 align-items-center">
            <div className="col-auto">
              <h1>实验列表</h1>
            </div>
            <div style={{ flex: 1 }} />
            {settings.powerCalculatorEnabled && (
              <div className="col-auto">
                <LinkButton variant="outline" href="/power-calculator">
                  功效计算器
                </LinkButton>
              </div>
            )}
            {/* {canAdd && (
              <div className="col-auto">{addExperimentDropdownButton}</div>
            )} */}
            {canAdd && (
              <Button
                className="col-auto" // 这里可以根据你的样式需求修改按钮的类名，设置合适的样式
                onClick={() => setOpenNewExperimentModal(true)}
              >
                创建实验
              </Button>
            )}
          </div>
          <CustomMarkdown page={"experimentList"} />
          {!hasExperiments ? (
            <div className="box py-4 text-center">
              <div className="mx-auto" style={{ maxWidth: 650 }}>
                {/* <h1>用目标用户测试变体</h1> */}
                <h1>创建您的第一个实验</h1>
                <p style={{ fontSize: "17px" }}>
                  通过关联特性标志、URL重定向或可视化编辑器进行无限次测试。您还可以轻松地从其他平台导入现有实验。
                </p>
              </div>
              <div
                className="d-flex justify-content_center"
                style={{ gap: "1rem" }}
              >
                {showSetupInstructionsButton && (
                  <LinkButton
                    href="/getstarted/experiment-guide"
                    variant="outline"
                  >
                    设置说明
                  </LinkButton>)}
                {/* {canAdd && addExperimentDropdownButton} */}
              </div>
            </div>
          ) : (
            <>
              <div className="row align-items-center mb-3">
                <div className="col-auto d-flex">
                  {["运行中", "草稿", "已停止", "已归档"].map(
                    (tab, i) => {
                      const active = tabs.includes(tab);

                      if (tab === "已归档" && !hasArchived) return null;

                      return (
                        <button
                          key={tab}
                          className={clsx("border mb-0", {
                            "badge-purple font-weight-bold": active,
                            "bg-white text-secondary": !active,
                            "rounded-left": i === 0,
                            "rounded-right":
                              tab === "已归档" ||
                              (tab === "已停止" && !hasArchived),
                          })}
                          style={{
                            fontSize: "1em",
                            opacity: active ? 1 : 0.8,
                            padding: "6px 12px",
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            onToggleTab(tab)();
                          }}
                          title={
                            active && tabs.length > 1
                              ? `隐藏${tab}实验`
                              : active
                                ? `移除过滤器`
                                : tabs.length === 0
                                  ? `仅查看${tab}实验`
                                  : `包含${tab}实验`
                          }
                        >
                          <span className="mr-1 ml-2">
                            {tab.slice(0, 1).toUpperCase()}
                            {tab.slice(1)}
                          </span>
                          {tab !== "已归档" && (
                            <span className="badge bg-white border text-dark mr-2 mb-0">
                              {tabCounts[tab] || 0}
                            </span>
                          )}
                        </button>
                      );
                    }
                  )}
                </div>
                <div className="col-auto">
                  <Field
                    placeholder="搜索..."
                    type="search"
                    {...searchInputProps}
                  />
                </div>
                <div className="col-auto">
                  <TagsFilter filter={tagsFilter} items={items} />
                </div>
                <div className="col-auto">
                  <Link
                    href="https://docs.growthbook.io/using/growthbook-best-practices#syntax-search"
                    target="_blank"
                  >
                    <Tooltip body={searchTermFilterExplainations}></Tooltip>
                  </Link>
                </div>
                <div className="col-auto ml-auto">
                  <Toggle
                    id="my-experiments-toggle"
                    type="toggle"
                    value={showMineOnly}
                    setValue={(value) => {
                      setShowMineOnly(value);
                    }}
                  />{" 仅我的实验"}
                </div>
              </div>

              <table className="appbox table experiment-table gbtable responsive-table">
                <thead>
                  <tr>
                    <th></th>
                    <SortableTH field="name" className="w-100">
                      实验
                    </SortableTH>
                    {showProjectColumn && (
                      <SortableTH field="projectName">项目</SortableTH>
                    )}
                    <SortableTH field="tags">标签</SortableTH>
                    <SortableTH field="ownerName">所有者</SortableTH>
                    <SortableTH field="status">状态</SortableTH>
                    <SortableTH field="date">日期</SortableTH>
                    <th>摘要</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(start, end).map((e) => {
                    const phase = e.phases?.[e.phases.length - 1];
                    return (
                      <tr key={e.id} className="hover-highlight">
                        <td data-title="关注状态：" className="watching">
                          <WatchButton
                            item={e.id}
                            itemType="experiment"
                            type="icon"
                          />
                        </td>
                        <td data-title="实验名称：" className="p-0">
                          <Link
                            href={`/experiment/${e.id}`}
                            className="d-block p-2"
                          >
                            <div className="d-flex flex-column">
                              <div className="d-flex">
                                <span className="testname">{e.name}</span>
                                {e.hasVisualChangesets ? (
                                  <Tooltip
                                    className="d-flex align-items-center ml-2"
                                    body="可视化实验"
                                  >
                                    <RxDesktop className="text-blue" />
                                  </Tooltip>
                                ) : null}
                                {(e.linkedFeatures || []).length > 0 ? (
                                  <Tooltip
                                    className="d-flex align-items-center ml-2"
                                    body="关联特性标志"
                                  >
                                    <BsFlag className="text-blue" />
                                  </Tooltip>
                                ) : null}
                                {e.hasURLRedirects ? (
                                  <Tooltip
                                    className="d-flex align-items-center ml-2"
                                    body="URL重定向实验"
                                  >
                                    <PiShuffle className="text-blue" />
                                  </Tooltip>
                                ) : null}
                              </div>
                              {isFiltered && e.trackingKey && (
                                <span
                                  className="testid text-muted small"
                                  title="实验编号"
                                >
                                  {e.trackingKey}
                                </span>
                              )}
                            </div>
                          </Link>
                        </td>
                        {showProjectColumn && (
                          <td className="nowrap" data-title="项目：">
                            {e.projectIsDeReferenced ? (
                              <Tooltip
                                body={
                                  <>
                                    项目 <code>{e.project}</code> 未找到
                                  </>
                                }
                              >
                                <span className="text-danger">
                                  无效项目
                                </span>
                              </Tooltip>
                            ) : (
                              e.projectName ?? <em>无</em>
                            )}
                          </td>
                        )}

                        <td data-title="标签：" className="table-tags">
                          <SortedTags
                            tags={Object.values(e.tags)}
                            useFlex={true}
                          />
                        </td>
                        <td className="nowrap" data-title="所有者：">
                          {e.ownerName}
                        </td>
                        <td className="nowrap" data-title="状态：">
                          {e.archived ? (
                            <span className="badge badge-secondary">
                              已归档
                            </span>
                          ) : (
                            <ExperimentStatusIndicator status={e.status} />
                          )}
                        </td>
                        <td className="nowrap" title={datetime(e.date)}>
                          {e.tab === "running"
                            ? "started"
                            : e.tab === "drafts"
                              ? "created"
                              : e.tab === "stopped"
                                ? "ended"
                                : e.tab === "archived"
                                  ? "updated"
                                  : ""}{" "}
                          {date(e.date)}
                        </td>
                        <td className="nowrap" data-title="摘要：">
                          {e.archived ? (
                            ""
                          ) : e.status === "running" && phase ? (
                            phaseSummary(phase, e.type === "multi-armed-bandit")
                          ) : e.status === "stopped" && e.results ? (
                            <ResultsIndicator results={e.results} />
                          ) : (
                            ""
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length > NUM_PER_PAGE && (
                <Pagination
                  numItemsTotal={filtered.length}
                  currentPage={currentPage}
                  perPage={NUM_PER_PAGE}
                  onPageChange={setCurrentPage}
                />
              )}
            </>
          )}
        </div>
      </div>
      {openNewExperimentModal && (
        <NewExperimentForm
          onClose={() => setOpenNewExperimentModal(false)}
          source="bandits-list"
          isNewExperiment={true}
        />
      )}
      {openImportExperimentModal && (
        <ImportExperimentModal
          onClose={() => setOpenImportExperimentModal(false)}
          source="experiment-list"
        />
      )}
    </>
  );
};

export default ExperimentsPage;