import React, { FC, useRef, useState } from "react";
import {
  EventInterface,
  NotificationEventName,
} from "shared/types/events/event";
import { PiDownloadSimple } from "react-icons/pi";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { date } from "shared/dates";
import useApi from "@/hooks/useApi";
import { useDownloadDataExport } from "@/hooks/useDownloadDataExport";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import LoadingOverlay from "@/components/LoadingOverlay";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Pagination from "@/components/Pagination";
import { EventsTableRow } from "@/components/Events/EventsPage/EventsTableRow";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import DatePicker from "@/components/DatePicker";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import { SettingsPageHeader } from "@/components/Layout/SettingsPage";
import DateRangeTriggerPopover from "@/enterprise/components/ProductAnalytics/DateRangeTriggerPopover";
import { ariaSort, SortButton } from "@/services/search";
import EventTypeFilter from "./EventTypeFilter";

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
  const { data: freshData, error } = useApi<{
    events: EventInterface[];
  }>("/events?" + filterURLParams);
  const permissionsUtil = usePermissionsUtil();
  // Keeps the last results while refetching so open filter dropdowns stay mounted.
  const lastData = useRef(freshData);
  if (freshData) lastData.current = freshData;
  const data = freshData ?? lastData.current;
  const refreshing = !freshData && !error;

  if (!data) {
    return <LoadingSpinner />;
  }
  const events = data.events;

  if (!permissionsUtil.canViewAuditLogs()) {
    return (
      <Callout status="error">
        You do not have access to view this page.
      </Callout>
    );
  }

  return (
    <div>
      <SettingsPageHeader
        title="Events Log"
        description="Every change made in your organization."
        actions={
          <PremiumTooltip
            commercialFeature="audit-logging"
            premiumText="Exporting events is available to Enterprise customers"
          >
            <Button
              onClick={performDownload}
              disabled={isDownloading || !shouldShowExportButton}
              icon={<PiDownloadSimple />}
            >
              Export all
            </Button>
          </PremiumTooltip>
        }
      />

      <Flex justify="between" align="center" gap="4" mt="2">
        {filters}
      </Flex>
      {error && (
        <Callout status="error" mt="2">
          There was an error loading the events.
        </Callout>
      )}
      {hasExportError && (
        <Callout status="error" mt="2">
          There was an error exporting the events.
        </Callout>
      )}

      {!error && (
        <Box position="relative" mt="3">
          {refreshing && <LoadingOverlay />}
          <table className="table gbtable appbox">
            <thead>
              <tr>
                <th
                  style={{ width: 200 }}
                  aria-sort={ariaSort(sort.field === "dateCreated", sort.dir)}
                >
                  <SortButton
                    active={sort.field === "dateCreated"}
                    dir={sort.dir}
                    subtle
                    onClick={() =>
                      setSort({
                        field: "dateCreated",
                        dir: sort.dir * -1,
                      })
                    }
                  >
                    Date
                  </SortButton>
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
                        No events were found. Events are created when users
                        interact with the system.
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
        </Box>
      )}
    </div>
  );
};

const DATE_PRESETS = [
  { value: "all", label: "All time", days: 0 },
  { value: "1", label: "Last 24 hours", days: 1 },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
] as const;
type DatePreset = (typeof DATE_PRESETS)[number]["value"] | "custom";

function DateRangeFilter({
  preset,
  setPreset,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
}: {
  preset: DatePreset;
  setPreset: (preset: DatePreset) => void;
  fromDate: Date | undefined;
  setFromDate: (date: Date | undefined) => void;
  toDate: Date | undefined;
  setToDate: (date: Date | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const label =
    preset !== "custom"
      ? DATE_PRESETS.find((p) => p.value === preset)?.label
      : fromDate && toDate
        ? `${date(fromDate)} – ${date(toDate)}`
        : fromDate
          ? `From ${date(fromDate)}`
          : toDate
            ? `Until ${date(toDate)}`
            : "All time";

  return (
    <DateRangeTriggerPopover
      open={open}
      onOpenChange={setOpen}
      label={label ?? "All time"}
      align="end"
      panelWidth={324}
    >
      <Box p="3" style={{ minHeight: 0, overflowY: "auto" }}>
        <RadioGroup
          options={DATE_PRESETS.map((p) => ({
            value: p.value,
            label: p.label,
          }))}
          value={preset === "custom" ? "" : preset}
          setValue={(value) => {
            const days = DATE_PRESETS.find((p) => p.value === value)?.days ?? 0;
            setPreset(value as DatePreset);
            setFromDate(
              days ? new Date(Date.now() - days * 86400000) : undefined,
            );
            setToDate(undefined);
            setOpen(false);
          }}
        />
        <Separator size="4" my="3" />
        <Text as="div" weight="semibold" mb="2">
          Custom range
        </Text>
        <Flex gap="2">
          <Box flexGrow="1">
            <Text
              as="label"
              htmlFor="events-from"
              size="sm"
              color="text-mid"
              mb="1"
            >
              From
            </Text>
            <DatePicker
              id="events-from"
              size="md"
              date={preset === "custom" ? fromDate : undefined}
              setDate={(d) => {
                setPreset("custom");
                setFromDate(d);
              }}
              scheduleEndDate={toDate}
              precision="date"
              containerClassName=""
            />
          </Box>
          <Box flexGrow="1">
            <Text
              as="label"
              htmlFor="events-to"
              size="sm"
              color="text-mid"
              mb="1"
            >
              To
            </Text>
            <DatePicker
              id="events-to"
              size="md"
              date={toDate}
              setDate={(d) => {
                // A preset's From is hidden here, so it shouldn't linger.
                if (preset !== "custom") setFromDate(undefined);
                setPreset("custom");
                setToDate(d);
              }}
              scheduleStartDate={fromDate}
              precision="date"
              containerClassName=""
            />
          </Box>
        </Flex>
      </Box>
    </DateRangeTriggerPopover>
  );
}

export const EventsPageContainer = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(30);
  const [eventType, setEventType] = useState<NotificationEventName[]>([]);
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
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
      (toDate ? "&to=" + toDate?.toISOString() : ""),
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

  const filters = (
    <>
      <Box flexGrow="1" minWidth="0">
        <EventTypeFilter value={eventType} setValue={setEventType} />
      </Box>
      <DateRangeFilter
        preset={datePreset}
        setPreset={setDatePreset}
        fromDate={fromDate}
        setFromDate={setFromDate}
        toDate={toDate}
        setToDate={setToDate}
      />
      {hasFilters && (
        <Box flexShrink="0">
          <Link
            color="red"
            onClick={() => {
              setEventType([]);
              setFromDate(undefined);
              setToDate(undefined);
              setDatePreset("all");
            }}
          >
            Clear filters
          </Link>
        </Box>
      )}
      <Flex align="center" gap="2" flexShrink="0">
        <Text weight="semibold">Show</Text>
        <SelectField
          size="md"
          aria-label="Show events per page"
          containerStyles={{ control: (base) => ({ ...base, width: 72 }) }}
          containerClassName="mb-0"
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
      </Flex>
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
