import React, { FC, Fragment, ReactElement, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { SegmentInterface } from "back-end/types/segment";
import { IdeaInterface } from "back-end/types/idea";
import { MetricInterface } from "back-end/types/metric";
import Link from "next/link";
import clsx from "clsx";
import { ago } from "shared/dates";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/components/Radix/Button";
import SegmentForm from "@/components/Segments/SegmentForm";
import { useDefinitions } from "@/services/DefinitionsContext";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import { hasFileConfig, storeSegmentsInMongo } from "@/services/env";
import { DocLink } from "@/components/DocLink";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MoreMenu from "@/components/Dropdown/MoreMenu";

const SegmentPage: FC = () => {
  // 从定义上下文获取相关数据，包括分段、是否准备好、根据数据源ID获取数据源等信息
  const {
    segments,
    ready,
    getDatasourceById,
    datasources,
    error: segmentsError,
    mutateDefinitions: mutate,
  } = useDefinitions();

  const permissionsUtil = usePermissionsUtil();

  const hasCreatePermission = permissionsUtil.canCreateSegment();
  let canStoreSegmentsInMongo = false;

  if (!hasFileConfig() || (hasFileConfig() && storeSegmentsInMongo())) {
    canStoreSegmentsInMongo = true;
  }

  const [
    segmentForm,
    setSegmentForm,
  ] = useState<null | Partial<SegmentInterface>>(null);

  const { apiCall } = useAuth();

  if (!segmentsError && !ready) {
    return <LoadingOverlay />;
  }

  const getSegmentUsage = (s: SegmentInterface) => {
    return async (): Promise<ReactElement | null> => {
      try {
        const res = await apiCall<{
          status: number;
          ideas?: IdeaInterface[];
          metrics?: MetricInterface[];
          experiments?: { id: string; name: string }[];
          total?: number;
        }>(`/segments/${s.id}/usage`, {
          method: "GET",
        });

        const metricLinks: (ReactElement | string)[] = [];
        const ideaLinks: (ReactElement | string)[] = [];
        const expLinks: (ReactElement | string)[] = [];
        let subtitleText = "此segment未在其他任何地方被引用。";
        if (res.total) {
          subtitleText = "此segment在以下内容中被引用：";
          const refs: (ReactElement | string)[] = [];
          if (res.metrics && res.metrics.length) {
            refs.push(
              res.metrics.length === 1
                ? "1个指标"
                : res.metrics.length + "个指标"
            );
            res.metrics.forEach((m) => {
              metricLinks.push(
                <Link href={`/metrics/${m.id}`} className="">
                  {m.name}
                </Link>
              );
            });
          }
          if (res.ideas && res.ideas.length) {
            refs.push(
              res.ideas.length === 1
                ? "1个想法"
                : res.ideas.length + "个想法"
            );
            res.ideas.forEach((i) => {
              ideaLinks.push(<Link href={`/idea/${i.id}`}>{i.text}</Link>);
            });
          }
          if (res.experiments && res.experiments.length) {
            refs.push(
              res.experiments.length === 1
                ? "1个实验"
                : res.experiments.length + "个实验"
            );
            res.experiments.forEach((e) => {
              expLinks.push(<Link href={`/experiment/${e.id}`}>{e.name}</Link>);
            });
          }
          subtitleText += refs.join("和");

          return (
            <div>
              <p>{subtitleText}</p>
              {res.total > 0 && (
                <>
                  <div
                    className="row mx-2 mb-2 mt-1 py-2"
                    style={{ fontSize: "0.8rem", border: "1px solid #eee" }}
                  >
                    {metricLinks.length > 0 && (
                      <div className="col-6 text-smaller text-left">
                        指标：{" "}
                        <ul className="mb-0 pl-3">
                          {metricLinks.map((l, i) => {
                            return (
                              <Fragment key={i}>
                                <li className="">{l}</li>
                              </Fragment>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {expLinks.length > 0 && (
                      <div className="col-6 text-smaller text-left">
                        实验：{" "}
                        <ul className="mb-0 pl-3">
                          {expLinks.map((l, i) => {
                            return (
                              <Fragment key={i}>
                                <li className="">{l}</li>
                              </Fragment>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {ideaLinks.length > 0 && (
                      <div className="col-6 text-smaller text-left">
                        想法：{" "}
                        <ul className="mb-0 pl-3">
                          {ideaLinks.map((l, i) => {
                            return (
                              <Fragment key={i}>
                                <li className="">{l}</li>
                              </Fragment>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                  <p className="mb-0">
                    删除此segment将移除这些引用
                  </p>
                </>
              )}
              <p>此操作无法撤销。</p>
            </div>
          );
        }
      } catch (e) {
        console.error(e);
        return (
          <div className="alert alert-danger">
            获取segment使用情况时出错
          </div>
        );
      }
      return null;
    };
  };

  const hasValidDataSources = !!datasources.filter(
    (d) => d.properties?.segments
  )[0];

  if (!hasValidDataSources) {
    return (
      <div className="p-3 container-fluid pagecontents">
        <div className="row mb-3">
          <div className="col d-flex">
            <h1>Segments</h1>
          </div>
        </div>
        <div className="alert alert-info">
          只有当您将CSII连接到兼容的数据源（Snowflake、Redshift、BigQuery、ClickHouse、Athena、Postgres、MySQL、MS SQL、Presto、Databricks或Mixpanel）时，Segment才可用。对其他数据源（如Google Analytics）的支持即将推出。
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 container-fluid pagecontents">
      {segmentForm && (
        <SegmentForm close={() => setSegmentForm(null)} current={segmentForm} />
      )}
      <div className="row mb-3">
        <div className="col-auto d-flex">
          <h1>Segment</h1>
        </div>
        <div style={{ flex: 1 }}></div>
        {hasCreatePermission && canStoreSegmentsInMongo && (
          <div className="col-auto">
            <Button
              onClick={() => {
                setSegmentForm({});
              }}
            >
              添加Segment
            </Button>
          </div>
        )}
      </div>
      {segmentsError && (
        <div className="alert alert-danger">
          加载Segment列表时出错
        </div>
      )}
      {segments.length > 0 && (
        <div className="行 mb-4">
          <div className="列-12">
            <p>
              Segment定义了重要的用户组 - 例如，“年度订阅者”或“来自法国的左撇子”。
            </p>
            <table
              className={clsx("表 appbox gbtable", {
                "表悬停": !hasFileConfig(),
              })}
            >
              <thead>
                <tr>
                  <th>名称</th>
                  <th>所有者</th>
                  <th className="d-none d-sm-table-cell">数据源</th>
                  <th className="d-none d-md-table-cell">标识类型</th>
                  {canStoreSegmentsInMongo ? <th>最后更新时间</th> : null}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {segments.map((s) => {
                  const datasource = getDatasourceById(s.datasource);
                  const userIdType = datasource?.properties?.userIds
                    ? s.userIdType || "user_id"
                    : "";
                  return (
                    <tr key={s.id}>
                      <td>
                        <>
                          {s.name}{" "}
                          {s.description ? (
                            <Tooltip body={s.description} />
                          ) : null}
                        </>
                      </td>
                      <td>{s.owner}</td>
                      <td className="d-none d-sm-table-cell">
                        {datasource && (
                          <>
                            <Link href={`/datasources/${datasource.id}`}>
                              {datasource.name}
                            </Link>{" "}
                            {datasource.description ? (
                              <Tooltip body={datasource.description} />
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="d-none d-md-table-cell">
                        <span
                          className="badge badge-secondary mr-1"
                          key={`${s.id}-${userIdType}`}
                        >
                          {userIdType}
                        </span>
                      </td>
                      {canStoreSegmentsInMongo ? (
                        <td>{ago(s.dateUpdated)}</td>
                      ) : null}
                      <td>
                        <MoreMenu>
                          {permissionsUtil.canUpdateSegment() &&
                            canStoreSegmentsInMongo ? (
                            <button
                              className="dropdown-item"
                              onClick={(e) => {
                                e.preventDefault();
                                setSegmentForm(s);
                              }}
                            >
                              <FaPencilAlt /> 编辑
                            </button>
                          ) : null}
                          {permissionsUtil.canDeleteSegment() &&
                            canStoreSegmentsInMongo ? (
                            <DeleteButton
                              className="dropdown-item"
                              displayName={s.name}
                              text="删除"
                              getConfirmationContent={getSegmentUsage(s)}
                              onClick={async () => {
                                await apiCall<{
                                  status: number;
                                  message?: string;
                                }>(`/segments/${s.id}`, {
                                  method: "DELETE",
                                  body: JSON.stringify({ id: s.id }),
                                });
                                await mutate({});
                              }}
                            />
                          ) : null}
                        </MoreMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {segments.length === 0 && !hasFileConfig() && (
        <div className="alert alert-info">
          您尚未定义任何分段。{" "}
          {hasCreatePermission && "点击上方按钮创建您的第一个segment。"}
        </div>
      )}
      {segments.length === 0 && hasFileConfig() && storeSegmentsInMongo() && (
        <div className="alert alert-info">
          您尚未定义任何Segment。您可以将它们添加到您的 <code>config.yml</code> 文件中，并移除 <code>STORE_SEGMENTS_IN_MONGO</code> 环境变量
          {hasCreatePermission && " 或者点击上方按钮创建您的第一个segment"}
          。 <DocLink docSection="config_yml">查看文档</DocLink>
        </div>
      )}
      {segments.length === 0 && hasFileConfig() && !storeSegmentsInMongo() && (
        <div className="alert alert-info">
          看起来您有一个 <code>config.yml</code> 文件。在那里定义的Segment将显示在此页面上。如果您想改为在MongoDB中存储和访问分段，请添加 <code>STORE_SEGMENTS_IN_MONGO</code> 环境变量。{" "}
          <DocLink docSection="config_yml">查看文档</DocLink>
        </div>
      )}
    </div>
  );
};

export default SegmentPage;