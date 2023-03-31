import React, { FC, useCallback, useState } from "react";
import {
  EventInterface,
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "back-end/types/event";
import { FaDownload } from "react-icons/fa";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { saveAs } from "@/services/files";
import LoadingSpinner from "../../LoadingSpinner";
import { EventsTableRow } from "./EventsTableRow";

type EventsPageProps = {
  isLoading: boolean;
  hasError: boolean;
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
  hasError,
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

        <div className="col-6 text-right ">
          <button
            onClick={performDownload}
            disabled={isDownloading}
            className="btn btn-primary"
          >
            <span className="mr-1">
              <FaDownload />
            </span>{" "}
            Export
          </button>
        </div>
      </div>

      {hasError && (
        <div className="alert alert-danger">
          There was an error loading the events.
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
  const { apiCall } = useAuth();

  const { data, error, isValidating } = useApi<{
    events: EventInterface<
      NotificationEventPayload<
        NotificationEventName,
        NotificationEventResource,
        unknown
      >
    >[];
  }>("/events");

  const [isDownloading, setIsDownloading] = useState(false);

  const performFileDownload = useCallback(() => {
    setIsDownloading(true);

    apiCall("/data-export/events?type=json").then(
      (response: { fileName: string; data: string }) => {
        saveAs({ textContent: response.data, fileName: response.fileName });

        setTimeout(() => {
          // Re-enable after some time to avoid spam
          setIsDownloading(false);
        }, 10000);
      }
    );
  }, [apiCall]);

  return (
    <EventsPage
      isLoading={isValidating}
      hasError={!!error}
      events={data?.events || []}
      isDownloading={isDownloading}
      performDownload={performFileDownload}
    />
  );
};
