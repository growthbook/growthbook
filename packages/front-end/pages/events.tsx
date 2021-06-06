import React, { useState, useEffect } from "react";
import useApi from "../hooks/useApi";
import LoadingOverlay from "../components/LoadingOverlay";
import { BsArrowRepeat } from "react-icons/bs";
import { FaSpinner } from "react-icons/fa";
import { useAuth } from "../services/auth";
import Link from "next/link";
import { useDefinitions } from "../services/DefinitionsContext";
//import Link from "next/link";

export interface Property {
  name: string;
  type: string;
  lastSeen: Date;
}

export interface EventInterface {
  name: string;
  lastSeen: Date;
  properties: Property[];
}

export interface TrackTableInterface {
  id: string;
  datasource: string;
  table: string;
  dateCreated: Date;
  dateUpdated: Date;
  events: EventInterface[];
}

interface EventsApiResponse {
  trackTables: TrackTableInterface[];
}

const EventsPage = (): React.ReactElement => {
  const [loading, setLoading] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [datasource, setDatasource] = useState<string | null>(null);

  const {
    datasources,
    ready,
    error: datasourceError,
    getDatasourceById,
  } = useDefinitions();
  const { data, error, mutate } = useApi<EventsApiResponse>("/events");

  useEffect(() => {
    if (datasources && datasources.length && datasource === null) {
      setDatasource(datasources[0].id);
    }
  }, [datasources]);

  const { apiCall } = useAuth();

  if (error || datasourceError) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error || datasourceError}
      </div>
    );
  }
  if (!data || !ready) {
    return <LoadingOverlay />;
  }
  if (!datasource) {
    return (
      <Link href="/datasources">
        <a className="btn btn-success">Add a Data Source</a>
      </Link>
    );
  }

  const datasourceObj = getDatasourceById(datasource);
  // BYO data sources already have tools to view events
  const eventsAllowed = datasourceObj.type === "athena";

  const events =
    data.trackTables.filter(
      (trackTable) => trackTable.datasource === datasource
    )[0]?.events || [];

  const refresh = async () => {
    if (loading) return;
    setLoading(true);
    setRefreshError(null);

    const res = await apiCall<{ status: number; message?: string }>(
      "/events/sync",
      {
        method: "POST",
        body: JSON.stringify({
          datasource,
        }),
      }
    );

    if (res.status > 200) {
      setRefreshError(res.message);
    } else {
      mutate();
    }

    setLoading(false);
  };

  return (
    <div className="container-fluid py-3 pagecontents">
      <h1 className="mb-3">Event Tracking</h1>
      <div className="form-inline mb-3">
        Data Source:
        <select
          className="form-control mx-3"
          value={datasource}
          onChange={(e) => {
            setDatasource(e.target.value);
          }}
        >
          {datasources.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      {eventsAllowed && (
        <>
          <button
            className={`btn btn-outline-${loading ? "secondary" : "primary"}`}
            disabled={loading}
            onClick={refresh}
          >
            {loading ? (
              <>
                <FaSpinner /> Refreshing...
              </>
            ) : (
              <>
                <BsArrowRepeat /> Refresh Events
              </>
            )}
          </button>
          {refreshError && (
            <div className="alert alert-danger">{refreshError}</div>
          )}
          {!events.length ? (
            <div className="alert alert-info">
              No events found. <a href="#">View setup instructions</a>
            </div>
          ) : (
            ""
          )}
          {events.map((event) => (
            <div className="mb-3" key={event.name}>
              <h2>{event.name}</h2>
              <table className="table table-bordered">
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Type</th>
                    <th>Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {event.properties.map((property) => (
                    <tr key={property.name}>
                      <td>{property.name}</td>
                      <td>{property.type}</td>
                      <td>{property.lastSeen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
      {!eventsAllowed && (
        <p>
          Events are only supported for data sources following the Growth Book
          schema.
        </p>
      )}
    </div>
  );
};

export default EventsPage;
