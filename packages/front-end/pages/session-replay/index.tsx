import React, { useEffect, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableRow,
} from "@/ui/Table";
import useApi from "@/hooks/useApi";
import Field from "@/components/Forms/Field";

// JSON-serialized shape of SessionReplayInterface coming from the back-end
// (Date fields arrive as ISO strings over the wire). The canonical type
// lives in `shared/validators/session-replay.ts`; we intentionally re-shape
// it here rather than importing it because front-end can't import `shared`
// types that contain Date instances when they cross the JSON boundary.
type SessionReplayRow = {
  id: string;
  organization: string;
  sessionId: string;
  clientKey: string;
  userId: string;
  storagePrefix: string;
  startedAt: string;
  endedAt: string;
  lastEventAt: string;
  durationMs: number;
  eventCount: number;
  urlFirst: string;
  urlsVisited: string[];
  attributes: Record<string, string>;
  experiments: [string, string][];
  flags: Record<string, string>;
  userAgent: string;
  state: "recording" | "finalized" | "deleted";
  dateCreated: string;
  dateUpdated: string;
};

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function SessionReplayPage() {
  const router = useRouter();
  const [userIdFilter, setUserIdFilter] = useState("");
  const [clientKeyFilter, setClientKeyFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [urlFilter, setUrlFilter] = useState("");

  const page = useMemo(() => {
    const raw = router.query.page;
    const value = parseInt(typeof raw === "string" ? raw : "1", 10);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }, [router.query.page]);

  useEffect(() => {
    if (!router.isReady) return;
    setUserIdFilter(
      typeof router.query.userId === "string" ? router.query.userId : "",
    );
    setClientKeyFilter(
      typeof router.query.clientKey === "string" ? router.query.clientKey : "",
    );
    setStateFilter(
      typeof router.query.state === "string" ? router.query.state : "",
    );
    setUrlFilter(typeof router.query.url === "string" ? router.query.url : "");
  }, [router.isReady, router.query]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    if (typeof router.query.userId === "string" && router.query.userId) {
      params.set("userId", router.query.userId);
    }
    if (typeof router.query.clientKey === "string" && router.query.clientKey) {
      params.set("clientKey", router.query.clientKey);
    }
    if (typeof router.query.state === "string" && router.query.state) {
      params.set("state", router.query.state);
    }
    if (typeof router.query.url === "string" && router.query.url) {
      params.set("url", router.query.url);
    }
    return params.toString();
  }, [
    page,
    router.query.clientKey,
    router.query.state,
    router.query.url,
    router.query.userId,
  ]);

  const { data: sessionsData, error: sessionsError } = useApi<{
    sessions: SessionReplayRow[];
  }>(`/api/session-replay?${queryString}`);

  const sessions = sessionsData?.sessions ?? [];
  const hasNextPage = sessions.length === 100;

  const updateRouteQuery = (next: {
    userId?: string;
    clientKey?: string;
    state?: string;
    url?: string;
    page: number;
  }) => {
    const query: Record<string, string> = {
      page: String(next.page),
    };
    if (next.userId) query.userId = next.userId;
    if (next.clientKey) query.clientKey = next.clientKey;
    if (next.state) query.state = next.state;
    if (next.url) query.url = next.url;
    void router.push(
      {
        pathname: "/session-replay",
        query,
      },
      undefined,
      { shallow: true },
    );
  };

  const applyFilters = () => {
    updateRouteQuery({
      userId: userIdFilter.trim(),
      clientKey: clientKeyFilter.trim(),
      state: stateFilter,
      url: urlFilter.trim(),
      page: 1,
    });
  };

  const clearFilters = () => {
    setUserIdFilter("");
    setClientKeyFilter("");
    setStateFilter("");
    setUrlFilter("");
    updateRouteQuery({ page: 1 });
  };

  const goToPage = (nextPage: number) => {
    updateRouteQuery({
      userId:
        typeof router.query.userId === "string" ? router.query.userId : "",
      clientKey:
        typeof router.query.clientKey === "string"
          ? router.query.clientKey
          : "",
      state: typeof router.query.state === "string" ? router.query.state : "",
      url: typeof router.query.url === "string" ? router.query.url : "",
      page: nextPage,
    });
  };

  return (
    <div className="pagecontents">
      <h1>Session Replay</h1>

      <Box className="box p-4">
        <Text size="x-large" weight="semibold">
          Recorded Sessions
        </Text>

        <Box mt="3">
          <Flex gap="3" wrap="wrap">
            <Field
              placeholder="Filter by user id"
              value={userIdFilter}
              onChange={(e) => setUserIdFilter(e.target.value)}
              containerStyle={{ maxWidth: 220, marginBottom: 0 }}
            />
            <Field
              placeholder="Filter by client key"
              value={clientKeyFilter}
              onChange={(e) => setClientKeyFilter(e.target.value)}
              containerStyle={{ maxWidth: 220, marginBottom: 0 }}
            />
            <Field
              options={["recording", "finalized", "deleted"]}
              initialOption="All states"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              containerStyle={{ maxWidth: 220, marginBottom: 0 }}
            />
            <Field
              placeholder="Filter by URL contains"
              value={urlFilter}
              onChange={(e) => setUrlFilter(e.target.value)}
              containerStyle={{ maxWidth: 260, marginBottom: 0 }}
            />
            <Button onClick={applyFilters}>Apply filters</Button>
            <Button variant="outline" onClick={clearFilters}>
              Clear
            </Button>
          </Flex>
        </Box>

        {sessionsError && (
          <Box mt="3">
            <Callout status="warning">Failed to load sessions</Callout>
          </Box>
        )}

        {!sessionsData && !sessionsError && (
          <Box mt="3">
            <Text color="text-mid">Loading sessions…</Text>
          </Box>
        )}

        {sessionsData && sessions.length === 0 && (
          <Box mt="3">
            <Text color="text-mid">
              No matching sessions found for the current filters.
            </Text>
          </Box>
        )}

        {sessionsData && sessions.length > 0 && (
          <Box mt="3" style={{ maxHeight: 640, overflowY: "auto" }}>
            <Table>
              <thead>
                <tr>
                  <TableColumnHeader>Session ID</TableColumnHeader>
                  <TableColumnHeader>User</TableColumnHeader>
                  <TableColumnHeader>Started</TableColumnHeader>
                  <TableColumnHeader>Duration</TableColumnHeader>
                  <TableColumnHeader>Events</TableColumnHeader>
                  <TableColumnHeader>URL</TableColumnHeader>
                </tr>
              </thead>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow
                    key={session.sessionId}
                    onClick={() =>
                      void router.push(
                        `/session-replay/${encodeURIComponent(session.sessionId)}`,
                      )
                    }
                    style={{ cursor: "pointer" }}
                  >
                    <TableCell>
                      <code title={session.sessionId}>
                        {session.sessionId?.slice(0, 8) ?? "unknown"}…
                      </code>
                    </TableCell>
                    <TableCell>
                      {session.userId || <em>anonymous</em>}
                    </TableCell>
                    <TableCell>
                      {new Date(session.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{formatDuration(session.durationMs)}</TableCell>
                    <TableCell>{session.eventCount}</TableCell>
                    <TableCell
                      style={{
                        maxWidth: 200,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={session.urlFirst}
                    >
                      {session.urlFirst || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        <Flex justify="between" align="center" mt="4">
          <Text color="text-mid">Page {page}</Text>
          <Flex gap="2">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              Previous
            </Button>
            <Button disabled={!hasNextPage} onClick={() => goToPage(page + 1)}>
              Next
            </Button>
          </Flex>
        </Flex>
      </Box>
    </div>
  );
}
