import React, { FC } from "react";
import {
  EventInterface,
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "back-end/types/event";
import { FaDownload } from "react-icons/fa";
import useApi from "@front-end/hooks/useApi";
import { useDownloadDataExport } from "@front-end/hooks/useDownloadDataExport";
import { useUser } from "@front-end/services/UserContext";
import PremiumTooltip from "@front-end/components/Marketing/PremiumTooltip";
import LoadingSpinner from "@front-end/components/LoadingSpinner";
import { EventsTableRow } from "./EventsTableRow";

type EventsPageProps = {
  isLoading: boolean;
  shouldShowExportButton: boolean;
  hasLoadError: boolean;
  hasExportError: boolean;
  performDownload: () => void;
  isDownloading: boolean;
  events: EventInterface<
    NotificationEventPayload<
      NotificationEventName,
      NotificationEventResource,
      unknown
    >
  >[];
};

export const EventsPage: FC<EventsPageProps> = ({
  events = [],
  shouldShowExportButton,
  hasLoadError,
  hasExportError,
  isLoading,
  performDownload,
  isDownloading,
}) => {
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
            Export
          </button>
        </div>
      </div>

      {hasLoadError && (
        <div className="alert alert-danger mt-2">
          There was an error loading the events.
        </div>
      )}
      {hasExportError && (
        <div className="alert alert-danger mt-2">
          There was an error exporting the events.
        </div>
      )}

      {isLoading && <LoadingSpinner />}
      {events.length === 0 ? (
        // Empty state
        <div className="row">
          <div className="col-xs-12 col-md-6 offset-md-3">
            <div className="card text-center p-3">
              When events are created, they will show up here.
            </div>
          </div>
        </div>
      ) : (
        // With data
        <table className="mt-3 table gbtable appbox--align-top table-hover appbox">
          <thead>
            <tr>
              <th style={{ width: 200 }}>Date</th>
              <th>Event Data</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <EventsTableRow key={event.id} event={event} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export const EventsPageContainer = () => {
  const { data, error, isValidating } = useApi<{
    events: EventInterface<
      NotificationEventPayload<
        NotificationEventName,
        NotificationEventResource,
        unknown
      >
    >[];
  }>("/events");

  const {
    isDownloading,
    performDownload,
    hasError: hasExportError,
  } = useDownloadDataExport({
    url: "/data-export/events?type=json",
  });

  const { hasCommercialFeature } = useUser();
  const enableExports = hasCommercialFeature("audit-logging");

  return (
    <EventsPage
      shouldShowExportButton={enableExports}
      isLoading={isValidating}
      hasLoadError={!!error}
      hasExportError={hasExportError}
      events={data?.events || []}
      isDownloading={isDownloading}
      performDownload={performDownload}
    />
  );
};
