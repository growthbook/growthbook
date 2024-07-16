import React, { FC, useState } from "react";
import { EventInterface, NotificationEventName } from "back-end/types/event";
import { NotificationEvent } from "back-end/src/events/notification-events";
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
    events: EventInterface<NotificationEvent>[];
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
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return (
    <div className="container py-4">
      <div className="row">
        <div className="col-6">
          <h1>Events</h1>
        </div>

        <div className="col-6 text-right">
          <PremiumTooltip commercialFeature="audit-logging">
            {shouldShowExportButton
              ? ""
              : "Exporting events is available to Enterprise customers"}
          </PremiumTooltip>

          <button
            onClick={performDownload}
            disabled={isDownloading || !shouldShowExportButton}
            className="btn btn-primary ml-3"
          >
            <span className="mr-1">
              <FaDownload />
            </span>{" "}
            Export All
          </button>
        </div>
      </div>

      <div className="d-flex justify-content-between flex-row mt-2">
        {filters}
      </div>
      {error && (
        <div className="alert alert-danger mt-2">
          There was an error loading the events.
        </div>
      )}
      {hasExportError && (
        <div className="alert alert-danger mt-2">
          There was an error exporting the events.
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
                Date{" "}
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
            <th>Type</th>
            <th>By</th>
            <th>Data</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 ? (
            // Empty state
            <tr>
              <td colSpan={5}>
                {hasFilters ? (
                  <div className="text-center">
                    No events were found that match the filters.
                  </div>
                ) : (
                  <div className="text-center">
                    No events were found. Events are created when users interact
                    with the system.
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
          placeholder="Filter event type"
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
          label="From"
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
          label="To"
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
            Clear
          </button>
        </div>
      )}
      <div className="flex-grow-1"></div>
      <div>
        <SelectField
          containerClassName="ml-2 d-flex align-items-center mb-0"
          labelClassName="mr-2 mb-0"
          label="Show"
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
