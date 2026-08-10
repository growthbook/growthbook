import React, { useState } from "react";
import { useRouter } from "next/router";
import { Flex } from "@radix-ui/themes";
import { datetime, parseUtcInstantForDisplay } from "shared/dates";
import PageHead from "@/components/Layout/PageHead";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import { useFeatureDisabledRedirect } from "@/hooks/useFeatureDisabledRedirect";

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
  const { ready: featureReady, shouldRender } = useFeatureDisabledRedirect(
    "enable-error-tracking",
  );
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

  if (!featureReady || !shouldRender) {
    return <LoadingOverlay />;
  }

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
      <Flex justify="between" mb="3">
        <h1 className="h3">Events</h1>
        <Link
          href={`/error-tracking/${encodeURIComponent(fingerprint)}?clientKey=${encodeURIComponent(clientKey)}`}
        >
          Back to issue
        </Link>
      </Flex>

      <Flex gap="2" align="end" mb="3">
        <Field
          label="Search (title or event id)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              runSearch();
            }
          }}
        />
        <Button onClick={runSearch}>Search</Button>
      </Flex>

      {error && <Callout status="error">{error.message}</Callout>}
      {isLoading && <LoadingOverlay />}

      {data?.events && (
        <Table variant="list">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Event Id</TableColumnHeader>
              <TableColumnHeader>Timestamp</TableColumnHeader>
              <TableColumnHeader>Title</TableColumnHeader>
              <TableColumnHeader>Transaction</TableColumnHeader>
              <TableColumnHeader>Release</TableColumnHeader>
              <TableColumnHeader>Environment</TableColumnHeader>
              <TableColumnHeader>User</TableColumnHeader>
              <TableColumnHeader>Device</TableColumnHeader>
              <TableColumnHeader>OS</TableColumnHeader>
              <TableColumnHeader>URL</TableColumnHeader>
              <TableColumnHeader>Runtime</TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.events.map((ev) => (
              <TableRow key={ev.eventId}>
                <TableCell>
                  <Link
                    href={`/error-tracking/${encodeURIComponent(fingerprint)}?clientKey=${encodeURIComponent(clientKey)}&event=${encodeURIComponent(ev.eventId)}`}
                  >
                    {ev.eventId}
                  </Link>
                </TableCell>
                <TableCell>
                  {datetime(parseUtcInstantForDisplay(ev.timestamp))}
                </TableCell>
                <TableCell>{ev.title}</TableCell>
                <TableCell>{ev.transaction}</TableCell>
                <TableCell>{ev.release}</TableCell>
                <TableCell>{ev.environment}</TableCell>
                <TableCell>{ev.user}</TableCell>
                <TableCell>{ev.device}</TableCell>
                <TableCell>{ev.os}</TableCell>
                <TableCell style={{ maxWidth: 200 }} className="text-truncate">
                  {ev.url}
                </TableCell>
                <TableCell>{ev.runtime}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
