import React, { useState } from "react";
import { useRouter } from "next/router";
import { datetime, parseUtcInstantForDisplay } from "shared/dates";
import PageHead from "@/components/Layout/PageHead";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";

type Row = {
  eventId: string;
  timestamp: string;
  title: string;
  transaction: string;
  release: string;
  environment: string;
  user: string;
  device: string;
  os: string;
  url: string;
  runtime: string;
};

export default function ErrorIssueEventsPage(): React.ReactElement {
  const router = useRouter();
  const fingerprint = router.query.fingerprint as string;
  const clientKey = router.query.clientKey as string;
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");

  const url =
    fingerprint && clientKey
      ? `/error-tracking/issues/${encodeURIComponent(fingerprint)}/events?clientKey=${encodeURIComponent(clientKey)}&q=${encodeURIComponent(search)}`
      : "";

  const { data, error, isLoading } = useApi<{ events: Row[] }>(url, {
    shouldRun: () => !!fingerprint && !!clientKey,
  });

  if (!clientKey) {
    return (
      <div className="container-fluid pagecontents">
        <Callout status="warning">Missing clientKey query parameter.</Callout>
      </div>
    );
  }

  const runSearch = () => {
    setSearch(q.trim());
  };

  return (
    <div className="container-fluid pagecontents">
      <PageHead
        breadcrumb={[
          { display: "Error Tracking", href: "/error-tracking" },
          {
            display: "Events",
            href: `/error-tracking/${encodeURIComponent(fingerprint)}?clientKey=${encodeURIComponent(clientKey)}`,
          },
        ]}
      />
      <div className="d-flex justify-content-between mb-3">
        <h1 className="h3">Events</h1>
        <Link
          href={`/error-tracking/${encodeURIComponent(fingerprint)}?clientKey=${encodeURIComponent(clientKey)}`}
        >
          Back to issue
        </Link>
      </div>

      <div className="row mb-3 align-items-end">
        <div className="col-md-5">
          <Field
            label="Search (title or event id)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            render={(id, ref) => (
              <div className="d-flex align-items-center" style={{ gap: 8 }}>
                <input
                  id={id}
                  ref={ref}
                  className="form-control"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      runSearch();
                    }
                  }}
                />
                <Button className="flex-shrink-0" onClick={runSearch}>
                  Search
                </Button>
              </div>
            )}
          />
        </div>
      </div>

      {error && <Callout status="error">{error.message}</Callout>}
      {isLoading && <LoadingOverlay />}

      {data?.events && (
        <div style={{ overflowX: "auto" }}>
          <table className="table table-hover table-sm">
            <thead>
              <tr>
                <th>Event Id</th>
                <th>Timestamp</th>
                <th>Title</th>
                <th>Transaction</th>
                <th>Release</th>
                <th>Environment</th>
                <th>User</th>
                <th>Device</th>
                <th>OS</th>
                <th>URL</th>
                <th>Runtime</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((ev) => (
                <tr key={ev.eventId}>
                  <td>
                    <Link
                      href={`/error-tracking/${encodeURIComponent(fingerprint)}?clientKey=${encodeURIComponent(clientKey)}&event=${encodeURIComponent(ev.eventId)}`}
                    >
                      {ev.eventId}
                    </Link>
                  </td>
                  <td>{datetime(parseUtcInstantForDisplay(ev.timestamp))}</td>
                  <td>{ev.title}</td>
                  <td>{ev.transaction}</td>
                  <td>{ev.release}</td>
                  <td>{ev.environment}</td>
                  <td>{ev.user}</td>
                  <td>{ev.device}</td>
                  <td>{ev.os}</td>
                  <td style={{ maxWidth: 200 }} className="text-truncate">
                    {ev.url}
                  </td>
                  <td>{ev.runtime}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
