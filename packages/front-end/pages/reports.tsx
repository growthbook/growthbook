import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { ReportInterface } from "back-end/types/report";
import { ExperimentInterface } from "back-end/types/experiment";
import { datetime, ago } from "shared/dates";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAddComputedFields, useSearch } from "@/services/search";
import Tooltip from "@/components/Tooltip/Tooltip";
import useApi from "@/hooks/useApi";
import Toggle from "@/components/Forms/Toggle";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";

const ReportsPage = (): React.ReactElement => {
  const router = useRouter();

  const { data, error } = useApi<{
    reports: ReportInterface[];
    experiments: ExperimentInterface[];
  }>(`/reports`);
  const [onlyMyReports, setOnlyMyReports] = useState(true);

  const { userId, getUserDisplay } = useUser();
  const experimentNames = useMemo(() => {
    const map = new Map<string, string>();
    if (data?.experiments && data?.experiments.length > 0) {
      data.experiments.forEach((e) => {
        map.set(e.id, e.name);
      });
    }
    return map;
  }, [data?.experiments]);

  const reports = useAddComputedFields(
    data?.reports,
    (r) => ({
      userName: r.userId ? getUserDisplay(r.userId) : "",
      experimentName: r.experimentId ? experimentNames.get(r.experimentId) : "",
      status: r.status === "private" ? "私有" : "已发布",
    }),
    [experimentNames]
  );

  const filterResults = useCallback(
    (items: typeof reports) => {
      return items.filter((r) => {
        if (onlyMyReports) {
          return r.userId === userId;
        } else {
          // 当显示 '全部' 时，显示你所有的报告，但只显示其他人已发布的报告（或者如果状态未设置，因为是在更改之前）
          return r.userId === userId || r?.status === "已发布" || !r?.status;
        }
      });
    },
    [onlyMyReports, userId]
  );
  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTH,
    pagination,
  } = useSearch({
    items: reports,
    localStorageKey: "reports",
    defaultSortField: "dateUpdated",
    defaultSortDir: -1,
    searchFields: [
      "标题",
      "描述",
      "实验名称",
      "创建者",
      "最后更新时间",
    ],
    filterResults,
    pageSize: 20,
  });

  if (error) {
    return (
      <div className="alert alert-danger">
        发生错误: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  if (!reports.length) {
    return (
      <div className="container p-4">
        <h1>报告</h1>
        <p>
          报告是对实验的临时分析。使用它们可以在不影响主要实验的独立环境中探索结果。
        </p>

        <p>要创建你的第一份报告：</p>
        <ol>
          <li>转到一个实验</li>
          <li>点击结果标签</li>
          <li>打开更多菜单（更新按钮旁边的三个点）</li>
          <li>选择“临时报告”</li>
        </ol>

        <Link href="/experiments" className="btn btn-primary mb-2">
          转到实验
        </Link>

        <p>
          <em>注意:</em> 如果你的实验还没有结果或者没有连接到有效的数据源，你将看不到“临时报告”选项。
        </p>
      </div>
    );
  }

  return (
    <div className="container-fluid py-3 p-3 pagecontents">
      <div className="filters md-form row mb-3 align-items-center">
        <div className="col-auto">
          <h3>
            自定义报告{" "}
            <small className="text-muted">
              <Tooltip body="数据团队使用报告来探索实验结果" />
            </small>
          </h3>
        </div>
        <div className="col-lg-3 col-md-4 col-6">
          <Field placeholder="搜索..." type="search" {...searchInputProps} />
        </div>
        <div className="col-auto">
          <Toggle
            id={"onlymine"}
            value={onlyMyReports}
            label={"仅显示我的报告"}
            setValue={setOnlyMyReports}
          />
          仅显示我的报告
        </div>
        <div style={{ flex: 1 }} />
      </div>
      <table className="table appbox gbtable table-hover">
        <thead>
          <tr>
            <SortableTH field="title">标题</SortableTH>
            <SortableTH field="description">描述</SortableTH>
            <SortableTH field="status">状态</SortableTH>
            <SortableTH field="experimentName">实验</SortableTH>
            <SortableTH field="userName">创建者</SortableTH>
            <SortableTH field="dateUpdated">最后更新时间</SortableTH>
          </tr>
        </thead>
        <tbody>
          {items.map((report) => (
            <tr
              key={report.id}
              onClick={(e) => {
                e.preventDefault();
                router.push(`/report/${report.id}`);
              }}
              style={{ cursor: "pointer" }}
            >
              <td>
                <Link
                  href={`/report/${report.id}`}
                  className={`text-dark font-weight-bold`}
                >
                  {report.title}
                </Link>
              </td>
              <td
                className="text-muted"
                style={{
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "260px",
                  overflow: "hidden",
                }}
              >
                {report.description}
              </td>
              <td>{report.status}</td>
              <td>{report.experimentName}</td>
              <td>{report.userName}</td>
              <td
                title={datetime(report.dateUpdated)}
                className="d-none d-md-table-cell"
              >
                {ago(report.dateUpdated)}
              </td>
            </tr>
          ))}

          {!items.length && (
            <tr>
              <td colSpan={6} align={"center"}>
                {isFiltered
                  ? "没有匹配的报告"
                  : onlyMyReports
                  ? "你没有报告"
                  : "没有报告"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {pagination}
    </div>
  );
};

export default ReportsPage;    