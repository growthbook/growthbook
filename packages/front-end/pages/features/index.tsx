import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { useFeature } from "@growthbook/growthbook-react";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { date, datetime } from "shared/dates";
import {
  featureHasEnvironment,
  filterEnvironmentsByFeature,
  getMatchingRules,
  isFeatureStale,
  StaleFeatureReason,
} from "shared/util";
import { FaTriangleExclamation } from "react-icons/fa6";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBAddCircle } from "@/components/Icons";
import FeatureModal from "@/components/Features/FeatureModal";
import ValueDisplay from "@/components/Features/ValueDisplay";
import track from "@/services/track";
import { useAddComputedFields, useSearch } from "@/services/search";
import EnvironmentToggle from "@/components/Features/EnvironmentToggle";
import RealTimeFeatureGraph from "@/components/Features/RealTimeFeatureGraph";
import {
  getFeatureDefaultValue,
  getRules,
  useFeaturesList,
  useRealtimeData,
  useEnvironments,
} from "@/services/features";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import Pagination from "@/components/Pagination";
import TagsFilter, {
  filterByTags,
  useTagsFilter,
} from "@/components/Tags/TagsFilter";
import SortedTags from "@/components/Tags/SortedTags";
import Toggle from "@/components/Forms/Toggle";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import StaleFeatureIcon from "@/components/StaleFeatureIcon";
import StaleDetectionModal from "@/components/Features/StaleDetectionModal";
import Tab from "@/components/Tabs/Tab";
import Tabs from "@/components/Tabs/Tabs";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import Button from "@/components/Radix/Button";
import Callout from "@/components/Radix/Callout";
import FeaturesDraftTable from "./FeaturesDraftTable";

const NUM_PER_PAGE = 20;

export default function FeaturesPage() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showArchived, setShowArchived] = useState(false);
  const [
    featureToDuplicate,
    setFeatureToDuplicate,
  ] = useState<FeatureInterface | null>(null);
  const [
    featureToToggleStaleDetection,
    setFeatureToToggleStaleDetection,
  ] = useState<FeatureInterface | null>(null);

  const showGraphs = useFeature("feature-list-realtime-graphs").on;

  const { getUserDisplay } = useUser();

  const permissionsUtil = usePermissionsUtil();
  const { project, getProjectById } = useDefinitions();
  const environments = useEnvironments();
  const {
    features: allFeatures,
    experiments,
    loading,
    error,
    mutate,
    hasArchived,
  } = useFeaturesList(true, showArchived);

  const { usage, usageDomain } = useRealtimeData(
    allFeatures,
    !!router?.query?.mockdata,
    showGraphs
  );

  const staleFeatures = useMemo(() => {
    const staleFeatures: Record<
      string,
      { stale: boolean; reason?: StaleFeatureReason }
    > = {};
    allFeatures.forEach((feature) => {
      const featureEnvironments = filterEnvironmentsByFeature(
        environments,
        feature
      );
      const envs = featureEnvironments.map((e) => e.id);
      staleFeatures[feature.id] = isFeatureStale({
        feature,
        features: allFeatures,
        experiments,
        environments: envs,
      });
    });
    return staleFeatures;
  }, [allFeatures, experiments, environments]);

  const features = useAddComputedFields(
    allFeatures,
    (f) => {
      const projectId = f.project;
      const projectName = projectId ? getProjectById(projectId)?.name : "";
      const projectIsDeReferenced = projectId && !projectName;

      const { stale, reason: staleReason } = staleFeatures?.[f.id] || {
        stale: false,
      };

      return {
        ...f,
        projectId,
        projectName,
        projectIsDeReferenced,
        stale,
        staleReason,
        ownerName: getUserDisplay(f.owner, false) || "",
      };
    },
    [staleFeatures, getProjectById]
  );

  // 搜索相关
  const tagsFilter = useTagsFilter("features");
  const filterResults = useCallback(
    (items: typeof features) => {
      if (!showArchived) {
        items = items.filter((f) => !f.archived);
      }

      items = filterByTags(items, tagsFilter.tags);
      return items;
    },
    [showArchived, tagsFilter.tags]
  );

  const renderFeaturesTable = () => {
    return (
      features.length > 0 && (
        <div>
          <div className="row mb-2 align-items-center">
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
            {showArchivedToggle && (
              <div className="col">
                <Toggle
                  value={showArchived}
                  id="archived"
                  setValue={setShowArchived}
                ></Toggle>
                Show Archived
              </div>
            )}
            <div className="col-auto">
              <Link
                href="https://docs.growthbook.io/using/growthbook-best-practices#syntax-search"
                target="_blank"
              >
                <Tooltip body={searchTermFilterExplainations}></Tooltip>
              </Link>
            </div>
          </div>

          <table className="table gbtable table-hover appbox">
            <thead
              className="sticky-top bg-white shadow-sm"
              style={{ top: "56px", zIndex: 900 }}
            >
              <tr>
                <th></th>
                <SortableTH field="id">Feature Key</SortableTH>
                {showProjectColumn && <th>Project</th>}
                <SortableTH field="tags">Tags</SortableTH>
                {toggleEnvs.map((en) => (
                  <th key={en.id} className="text-center">
                    {en.id}
                  </th>
                ))}
                <th>Prerequisites</th>
                <th>
                  Default
                  <br />
                  Value
                </th>
                <th>Rules</th>
                <th>Version</th>
                <SortableTH field="dateUpdated">最后更新时间</SortableTH>
                {showGraphs && (
                  <th>
                    Recent Usage{" "}
                    <Tooltip body="客户端在过去30分钟内对功能的评估。蓝色表示功能处于“开启”状态，灰色表示处于“关闭”状态。" />
                  </th>
                )}
                <th>过期状态</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {featureItems.map((feature) => {
                let rules: FeatureRule[] = [];
                environments.forEach(
                  (e) => (rules = rules.concat(getRules(feature, e.id)))
                );

                // 当展示规则摘要时，优先展示实验规则，然后是推出规则，最后是强制规则
                const orderedRules = [
                  ...rules.filter((r) => r.type === "experiment"),
                  ...rules.filter((r) => r.type === "rollout"),
                  ...rules.filter((r) => r.type === "force"),
                ];

                const firstRule = orderedRules[0];
                const totalRules = rules.length || 0;

                const version = feature.version;

                const { stale, reason: staleReason } = staleFeatures?.[
                  feature.id
                ] || { stale: false };
                const topLevelPrerequisites =
                  feature.prerequisites?.length || 0;
                const prerequisiteRules = rules.reduce(
                  (acc, rule) => acc + (rule.prerequisites?.length || 0),
                  0
                );
                const totalPrerequisites =
                  topLevelPrerequisites + prerequisiteRules;

                return (
                  <tr
                    key={feature.id}
                    className={feature.archived ? "text-muted" : ""}
                  >
                    <td data-title="Watching status:" className="watching">
                      <WatchButton
                        item={feature.id}
                        itemType="feature"
                        type="icon"
                      />
                    </td>
                    <td>
                      <Link
                        href={`/features/${feature.id}`}
                        className={feature.archived ? "text-muted" : ""}
                      >
                        {feature.id}
                      </Link>
                    </td>
                    {showProjectColumn && (
                      <td>
                        {feature.projectIsDeReferenced ? (
                          <Tooltip
                            body={
                              <>
                                项目 <code>{feature.project}</code> 未找到
                              </>
                            }
                          >
                            <span className="text-danger">Invalid project</span>
                          </Tooltip>
                        ) : (
                          feature.projectName ?? <em>None</em>
                        )}
                      </td>
                    )}
                    <td>
                      <SortedTags tags={feature?.tags || []} />
                    </td>
                    {toggleEnvs.map((en) => (
                      <td key={en.id} className="position-relative text-center">
                        {featureHasEnvironment(feature, en) && (
                          <EnvironmentToggle
                            feature={feature}
                            environment={en.id}
                            mutate={mutate}
                          />
                        )}
                      </td>
                    ))}
                    <td>
                      {totalPrerequisites > 0 && (
                        <div style={{ lineHeight: "16px" }}>
                          <div className="text-dark">
                            {totalPrerequisites} total
                          </div>
                          <div className="nowrap text-muted">
                            <small>
                              {topLevelPrerequisites > 0 && (
                                <>{topLevelPrerequisites} top level</>
                              )}
                              {prerequisiteRules > 0 && (
                                <>
                                  <>
                                    {topLevelPrerequisites > 0 && ", "}
                                    {prerequisiteRules} rules
                                  </>
                                </>
                              )}
                            </small>
                          </div>
                        </div>
                      )}
                    </td>
                    <td style={{ minWidth: 90 }}>
                      <ValueDisplay
                        value={getFeatureDefaultValue(feature) || ""}
                        type={feature.valueType}
                        full={false}
                        additionalStyle={{ maxWidth: 120, fontSize: "11px" }}
                      />
                    </td>
                    <td>
                      <div style={{ lineHeight: "16px" }}>
                        {firstRule && (
                          <span className="text-dark">{firstRule.type}</span>
                        )}
                        {totalRules > 1 && (
                          <small className="text-muted ml-1">
                            +{totalRules - 1} more
                          </small>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {version}
                      {feature?.hasDrafts ? (
                        <Tooltip body="此功能有一个未发布的活动草稿。">
                          <FaTriangleExclamation
                            className="text-warning ml-1"
                            style={{ marginTop: -3 }}
                          />
                        </Tooltip>
                      ) : null}
                    </td>
                    <td title={datetime(feature.dateUpdated)}>
                      {date(feature.dateUpdated)}
                    </td>
                    {showGraphs && (
                      <td style={{ width: 170 }}>
                        <RealTimeFeatureGraph
                          data={usage?.[feature.id]?.realtime || []}
                          yDomain={usageDomain}
                        />
                      </td>
                    )}
                    <td style={{ textAlign: "center" }}>
                      {stale && (
                        <StaleFeatureIcon
                          staleReason={staleReason}
                          onClick={() => {
                            if (
                              permissionsUtil.canViewFeatureModal(
                                feature.project
                              )
                            )
                              setFeatureToToggleStaleDetection(feature);
                          }}
                        />
                      )}
                    </td>
                    <td>
                      <MoreMenu>
                        {permissionsUtil.canCreateFeature(feature) &&
                          permissionsUtil.canManageFeatureDrafts({
                            project: feature.projectId,
                          }) ? (
                          <button
                            className="dropdown-item"
                            onClick={() => {
                              setFeatureToDuplicate(feature);
                              setModalOpen(true);
                            }}
                          >
                            Duplicate
                          </button>
                        ) : null}
                      </MoreMenu>
                    </td>
                  </tr>
                );
              })}
              {!items.length && (
                <tr>
                  <td colSpan={showGraphs ? 7 : 6}>没有匹配的功能</td>
                </tr>
              )}
            </tbody>
          </table>
          {Math.ceil(items.length / NUM_PER_PAGE) > 1 && (
            <Pagination
              numItemsTotal={items.length}
              currentPage={currentPage}
              perPage={NUM_PER_PAGE}
              onPageChange={(d) => {
                setCurrentPage(d);
              }}
            />
          )}
        </div>
      )
    );
  };

  const searchTermFilterExplainations = (
    <>
      <p>此搜索字段支持高级语法搜索，包括：</p>
      <ul>
        <li>
          <strong>功能键</strong>：功能的键（名称）
        </li>
        <li>
          <strong>创建者</strong>：功能的创建者（例如：创建者:abby）
        </li>
        <li>
          <strong>规则</strong>：根据规则数量进行匹配（例如：规则:&gt;2）
        </li>
        <li>
          <strong>标签</strong>：带有此标签的功能
        </li>
        <li>
          <strong>项目</strong>：功能所属的项目
        </li>
        <li>
          <strong>版本</strong>：功能的修订版本号
        </li>
        <li>
          <strong>实验</strong>：功能与指定的实验相关联
        </li>
        <li>
          <strong>创建时间</strong>：功能的创建日期，采用UTC时间。输入的日期会进行解析，支持大多数格式。
        </li>
        <li>
          <strong>开启</strong>：显示在特定环境中处于开启状态的功能（开启:生产环境）
        </li>
        <li>
          <strong>关闭</strong>：显示在特定环境中处于关闭状态的功能（关闭:开发环境）
        </li>
      </ul>
      <p>点击查看我们文档中支持的所有语法字段。</p>
    </>
  );

  const { searchInputProps, items, SortableTH } = useSearch({
    items: features,
    defaultSortField: "id",
    searchFields: ["id^3", "description", "tags^2", "defaultValue"],
    filterResults,
    updateSearchQueryOnChange: true,
    localStorageKey: "功能列表",
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [item.valueType];
        if (item.archived) is.push("archived");
        if (item.hasDrafts) is.push("draft");
        if (item.stale) is.push("过期");
        return is;
      },
      has: (item) => {
        const has: string[] = [];
        if (item.project) has.push("project");
        if (item.hasDrafts) has.push("draft", "drafts");
        if (item.prerequisites?.length) has.push("prerequisites", "prereqs");

        if (item.valueType === "json" && item.jsonSchema?.enabled) {
          has.push("validation", "schema", "jsonSchema");
        }

        const rules = getMatchingRules(
          item,
          () => true,
          environments.map((e) => e.id)
        );

        if (rules.length) has.push("rule", "rules");
        if (
          rules.some((r) =>
            ["experiment", "experiment-ref"].includes(r.rule.type)
          )
        ) {
          has.push("experiment", "experiments");
        }
        if (rules.some((r) => r.rule.type === "rollout")) {
          has.push("rollout", "percent");
        }
        if (rules.some((r) => r.rule.type === "force")) {
          has.push("force", "targeting");
        }

        return has;
      },
      key: (item) => item.id,
      project: (item) => [item.project, item.projectName],
      created: (item) => new Date(item.dateCreated),
      updated: (item) => new Date(item.dateUpdated),
      experiment: (item) => item.linkedExperiments || [],
      version: (item) => item.version,
      revision: (item) => item.version,
      owner: (item) => item.owner,
      tag: (item) => item.tags,
      rules: (item) => {
        const rules = getMatchingRules(
          item,
          () => true,
          environments.map((e) => e.id)
        );
        return rules.length;
      },
      on: (item) => {
        const on: string[] = [];
        environments.forEach((e) => {
          if (
            featureHasEnvironment(item, e) &&
            item.environmentSettings?.[e.id]?.enabled
          ) {
            on.push(e.id);
          }
        });
        return on;
      },
      off: (item) => {
        const off: string[] = [];
        environments.forEach((e) => {
          if (
            featureHasEnvironment(item, e) &&
            !item.environmentSettings?.[e.id]?.enabled
          ) {
            off.push(e.id);
          }
        });
        return off;
      },
    },
  });
  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const featureItems = items.slice(start, end);

  // 当应用筛选器时重置到第1页
  useEffect(() => {
    setCurrentPage(1);
  }, [items.length]);

  // 当模态框关闭时重置待复制特性
  useEffect(() => {
    if (modalOpen) return;
    setFeatureToDuplicate(null);
  }, [modalOpen]);

  if (error) {
    return (
      <div className="alert alert-danger">
        发生错误：{error.message}
      </div>
    );
  }
  if (loading) {
    return <LoadingOverlay />;
  }

  // 如果选中“所有项目”且某个项目中有一些实验，则显示项目列
  const showProjectColumn = !project && features.some((f) => f.project);

  // 忽略演示数据源
  const hasFeatures = features.length > 0;

  const toggleEnvs = environments.filter((en) => en.toggleOnList);
  const showArchivedToggle = hasArchived;

  const canCreateFeatures = permissionsUtil.canManageFeatureDrafts({
    project,
  });

  return (
    <div className="contents container pagecontents">
      {modalOpen && (
        <FeatureModal
          cta={featureToDuplicate ? "复制" : "创建"}
          close={() => setModalOpen(false)}
          onSuccess={async (feature) => {
            const url = `/features/${feature.id}${hasFeatures ? "" : "?first"}`;
            router.push(url);
            mutate({
              features: [...features, feature],
              linkedExperiments: experiments,
              hasArchived,
            });
          }}
          featureToDuplicate={featureToDuplicate || undefined}
        />
      )}
      {featureToToggleStaleDetection && (
        <StaleDetectionModal
          close={() => setFeatureToToggleStaleDetection(null)}
          feature={featureToToggleStaleDetection}
          mutate={mutate}
        />
      )}
      <div className="row mb-3">
        <div className="col">
          <h1>Feature</h1>
        </div>
        {features.length > 0 &&
          permissionsUtil.canViewFeatureModal(project) &&
          canCreateFeatures && (
            <div className="col-auto">
              <Button
                onClick={() => {
                  setModalOpen(true);
                  track("Viewed Feature Modal", {
                    source: "feature-list",
                  });
                }}
              >
                添加Feature
              </Button>
            </div>
          )}
      </div>
      <p>
        Feature使您能够在GrowthBook UI内更改应用程序的行为。例如，打开/关闭销售横幅或更改定价页面的标题。
      </p>
      <div className="mt-3">
        <CustomMarkdown page={"featureList"} />
      </div>
      {!hasFeatures ? (
        <>
          <div
            className="appbox d-flex flex-column align-items-center"
            style={{ padding: "70px 305px 60px 305px" }}
          >
            <h1>更改应用程序的行为</h1>
            <p style={{ fontSize: "17px" }}>
              使用Feature标志来更改应用程序的行为。例如，打开或关闭销售横幅，或仅为测试版用户启用新Feature。
            </p>
            <div className="row">
              <Link href="/getstarted/feature-flag-guide">
                {" "}
                <button className="btn btn-outline-primary mr-2">
                  设置说明
                </button>
              </Link>

              {permissionsUtil.canViewFeatureModal(project) &&
                canCreateFeatures && (
                  <button
                    className="btn btn-primary float-right"
                    onClick={() => {
                      setModalOpen(true);
                      track("Viewed Feature Modal", {
                        source: "feature-list",
                      });
                    }}
                    type="button"
                  >
                    <span className="h4 pr-2 m-0 d-inline-block align-top">
                      <GBAddCircle />
                    </span>
                    添加Feature
                  </button>
                )}
            </div>
          </div>
        </>
      ) : (
        <Tabs newStyle={true} defaultTab="all-features">
          <Tab id="all-features" display="所有Feature" padding={false}>
            {renderFeaturesTable()}
            <Callout status="info" mt="5" mb="3">
              Looking for <strong>Attributes</strong>,{" "}
              <strong>Namespaces</strong>, <strong>Environments</strong>, or{" "}
              <strong>Saved Groups</strong>? They have moved to the{" "}
              <Link href="/sdks">SDK Configuration</Link> tab.
            </Callout>
          </Tab>
          <Tab id="drafts" display="草稿" padding={false} lazy={true}>
            <FeaturesDraftTable features={features} />
          </Tab>
        </Tabs>
      )}
    </div>
  );
}