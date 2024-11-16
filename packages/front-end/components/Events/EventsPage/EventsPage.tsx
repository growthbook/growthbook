import React, { FC, useState } from "react";
import { EventInterface, NotificationEventName } from "back-end/types/event";
import { FaDownload, FaSort, FaSortDown, FaSortUp } from "react-icons/fa";
import useApi from "@/hooks/useApi";
import { useDownloadDataExport } from "@/hooks/useDownloadDataExport";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Pagination from "@/components/Pagination";
import { EventsTableRow } from "@/components/Events/EventsPage/EventsTableRow";
import SelectField from "@/components/Forms/SelectField";
import { notificationEventNames } from "@/components/EventWebHooks/utils";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import Button from "@/components/Radix/Button";

type EventsPageProps = {
  filterURLParams: string;
  filters: React.ReactNode;
  hasFilters: boolean;
  sort: { field: string; dir: number };
  setSort: (sort: { field: string; dir: number }) => void;
  shouldShowExportButton: boolean;
  hasExportError: boolean;
  performDownload: () => void;
  isDownloading: boolean;
};

export const EventsPage: FC<EventsPageProps> = ({
  filterURLParams,
  filters,
  hasFilters,
  sort,
  setSort,
  shouldShowExportButton,
  hasExportError,
  performDownload,
  isDownloading,
}) => {
  const { data, error } = useApi<{
    events: EventInterface[];
  }>("/events?" + filterURLParams);
  const permissionsUtil = usePermissionsUtil();

  if (!data) {
    return <LoadingSpinner />;
  }
  const events = data.events;

  if (!permissionsUtil.canViewAuditLogs()) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          您无权查看此页面。
        </div>
      </div>
    );
  }

  return (
    <div className="container py-4">
      <div className="row">
        <div className="col-6">
          <h1>事件</h1>
        </div>

        {/* 屏蔽导出按钮 */}
        {/* <div className="col-6 text-right">
          <PremiumTooltip commercialFeature="audit-logging">
            {shouldShowExportButton
              ? ""
              : "导出事件功能仅对企业客户可用"}
          </PremiumTooltip>

          <Button
            onClick={performDownload}
            disabled={isDownloading || !shouldShowExportButton}
            ml="3"
            icon={<FaDownload />}
          >
            导出全部
          </Button>
        </div> */}
      </div>

      <div className="d-flex justify-content-between flex-row mt-2">
        {filters}
      </div>
      {error && (
        <div className="alert alert-danger mt-2">
          加载事件时出错。
        </div>
      )}
      {hasExportError && (
        <div className="alert alert-danger mt-2">
          导出事件时出错。
        </div>
      )}

      <table className="mt-3 table gbtable appbox--align-top table-hover appbox">
        <thead>
          <tr>
            <th style={{ width: 200 }}>
              <span
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setSort({
                    field: "dateCreated",
                    dir: sort.dir * -1,
                  });
                }}
              >
                日期{" "}
                <a
                  href="#"
                  className={
                    sort.field === "dateCreated" ? "activesort" : "inactivesort"
                  }
                >
                  {sort.field === "dateCreated" ? (
                    sort.dir < 0 ? (
                      <FaSortDown />
                    ) : (
                      <FaSortUp />
                    )
                  ) : (
                    <FaSort />
                  )}
                </a>
              </span>
            </th>
            <th>类型</th>
            <th>执行者</th>
            <th>数据</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 ? (
            // 空状态
            <tr>
              <td colSpan={5}>
                {hasFilters ? (
                  <div className="text-center">
                    未找到符合筛选条件的事件。
                  </div>
                ) : (
                  <div className="text-center">
                    未找到事件。事件在用户与系统交互时生成。
                  </div>
                )}
              </td>
            </tr>
          ) : (
            <>
              {events.map((event) => (
                <EventsTableRow key={event.id} event={event} />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
};

export const EventsPageContainer = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(30);
  const [eventType, setEventType] = useState<NotificationEventName[]>([]);
  const [fromDate, setFromDate] = useState<Date | null>(null);
  const [toDate, setToDate] = useState<Date | null>(null);
  const [sort, setSort] = useState<{ field: string; dir: number }>({
    field: "dateCreated",
    dir: -1,
  });

  const filterURLParams = new URLSearchParams({
    page: currentPage.toString(),
    perPage: perPage.toString(),
    from: fromDate ? fromDate.toISOString() : "",
    to: toDate ? toDate.toISOString() : "",
    type: JSON.stringify(eventType),
    sortOrder: sort.dir === 1 ? "asc" : "desc",
  }).toString();
  const { data } = useApi<{
    count: number;
  }>(
    "/events/count?type=" +
    JSON.stringify(eventType) +
    (fromDate ? "&from=" + fromDate?.toISOString() : "") +
    (toDate ? "&to=" + toDate?.toISOString() : "")
  );
  const {
    isDownloading,
    performDownload,
    hasError: hasExportError,
  } = useDownloadDataExport({
    url: "/data-export/events?type=json",
  });

  const { hasCommercialFeature } = useUser();
  const enableExports = hasCommercialFeature("audit-logging");

  const hasFilters = eventType.length > 0 || !!fromDate || !!toDate;
  const eventTypeOptions = notificationEventNames.map((name) => ({
    label: name,
    value: name,
  }));

  const filters = (
    <>
      <div>
        <MultiSelectField
          value={eventType}
          placeholder="筛选事件类型"
          sort={false}
          options={eventTypeOptions}
          onChange={(value: string[]) => {
            setEventType(value as NotificationEventName[]);
          }}
        />
      </div>
      <div>
        <Field
          type="date"
          label="起始日期"
          className="text-muted"
          labelClassName="mr-2 mb-0"
          containerClassName="ml-2 d-flex align-items-center mb-0"
          value={fromDate ? fromDate.toISOString().split("T")[0] : ""}
          onChange={(d) => {
            setFromDate(d.target.value ? new Date(d.target.value) : null);
          }}
        />
      </div>
      <div>
        <Field
          type="date"
          label="截止日期"
          className="text-muted"
          labelClassName="mr-2 mb-0"
          containerClassName="ml-2 d-flex align-items-center mb-0"
          value={toDate ? toDate.toISOString().split("T")[0] : ""}
          onChange={(d) => {
            setToDate(d.target.value ? new Date(d.target.value) : null);
          }}
        />
      </div>
      {hasFilters && (
        <div>
          <button
            className="btn btn-outline-info ml-2"
            onClick={(e) => {
              e.preventDefault();
              setEventType([]);
              setFromDate(null);
              setToDate(null);
            }}
          >
            清除
          </button>
        </div>
      )}
      <div className="flex-grow-1"></div>
      <div>
        <SelectField
          containerClassName="ml-2 d-flex align-items-center mb-0"
          labelClassName="mr-2 mb-0"
          label="显示数量"
          options={[
            {
              label: "10",
              value: "10",
            },
            {
              label: "20",
              value: "20",
            },
            {
              label: "30",
              value: "30",
            },
            {
              label: "50",
              value: "50",
            },
            {
              label: "100",
              value: "100",
            },
          ]}
          sort={false}
          value={"" + perPage}
          onChange={(v) => {
            if (parseInt(v) === perPage) return;
            setPerPage(parseInt(v));
          }}
        />
      </div>
    </>
  );

  return (
    <>
      <EventsPage
        filterURLParams={filterURLParams}
        filters={filters}
        hasFilters={hasFilters}
        sort={sort}
        setSort={setSort}
        shouldShowExportButton={enableExports}
        hasExportError={hasExportError}
        isDownloading={isDownloading}
        performDownload={performDownload}
      />
      <Pagination
        currentPage={currentPage}
        numItemsTotal={data?.count || 0}
        perPage={perPage}
        onPageChange={(page) => {
          setCurrentPage(page);
          //loadOrgs(page, search);
        }}
      />
    </>
  );
};