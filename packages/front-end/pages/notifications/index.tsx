import { FC, useCallback, useEffect, useState } from "react";
import { useGrowthBook } from "@growthbook/growthbook-react";
import router from "next/router";
import Link from "next/link";
import { Box, Flex } from "@radix-ui/themes";
import clsx from "clsx";
import { AppFeatures } from "@/types/app-features";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "@/components/LoadingOverlay";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { WhiteButton } from "@/ui/Button";
import track from "@/services/track";
import pageStyles from "./notifications.module.scss";

type ApiNotification = {
  id: string;
  title: string;
  body?: string;
  resourceType: string;
  resourceId: string;
  scope?: string;
  readAt: string | null;
  dateCreated: string;
};

type ListRes = {
  notifications: ApiNotification[];
  hasMore: boolean;
  nextCursor: string | null;
};

const NotificationsPage: FC = () => {
  const gb = useGrowthBook<AppFeatures>();
  const { apiCall } = useAuth();
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"" | "user" | "org" | "project">("");

  const hrefFor = (n: ApiNotification) => {
    if (n.resourceType === "feature") {
      return `/features/${encodeURIComponent(n.resourceId)}`;
    }
    if (n.resourceType === "experiment") {
      return `/experiment/${encodeURIComponent(n.resourceId)}`;
    }
    return "/";
  };

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const q = new URLSearchParams({ limit: "25" });
      if (cursor) q.set("cursor", cursor);
      if (scope) q.set("scope", scope);
      const res = await apiCall<ListRes>(`/notifications?${q.toString()}`);
      return res;
    },
    [apiCall, scope],
  );

  useEffect(() => {
    if (!gb) return;
    if (!gb.isOn("in-app-notifications")) {
      void router.replace("/");
    }
  }, [gb]);

  useEffect(() => {
    if (!gb) return;
    if (!gb.isOn("in-app-notifications")) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetchPage(null);
        if (cancelled) return;
        setItems(res.notifications);
        setHasMore(res.hasMore);
        setNextCursor(res.nextCursor);
        const ids = res.notifications.map((n) => n.id);
        if (ids.length) {
          await apiCall("/notifications/seen", {
            method: "POST",
            body: JSON.stringify({ ids }),
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gb, fetchPage, apiCall]);

  useEffect(() => {
    track("Viewed Notifications Page");
  }, []);

  const onMarkRead = useCallback(
    async (n: ApiNotification) => {
      await apiCall(`/notifications/${n.id}/read`, { method: "POST" });
      setItems((prev) =>
        prev.map((x) =>
          x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x,
        ),
      );
    },
    [apiCall],
  );

  const onMarkAllRead = useCallback(async () => {
    await apiCall("/notifications/read-all", { method: "POST" });
    setItems((prev) =>
      prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
    );
  }, [apiCall]);

  const onLoadMore = useCallback(async () => {
    if (!nextCursor) return;
    const res = await fetchPage(nextCursor);
    setItems((prev) => [...prev, ...res.notifications]);
    setHasMore(res.hasMore);
    setNextCursor(res.nextCursor);
    const ids = res.notifications.map((n) => n.id);
    if (ids.length) {
      await apiCall("/notifications/seen", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
    }
  }, [nextCursor, fetchPage, apiCall]);

  if (!gb) {
    return <LoadingOverlay />;
  }
  if (!gb.isOn("in-app-notifications")) {
    return null;
  }

  if (loading && items.length === 0) {
    return <LoadingOverlay />;
  }

  return (
    <Box className="container-fluid pagecontents">
      <Flex justify="between" align="start" mb="4" wrap="wrap" gap="3">
        <div>
          <Heading as="h1">Notifications</Heading>
          <Text color="text-low">
            Newest first. Read and unread notifications appear together, like an
            email inbox—use row styling to tell them apart.
          </Text>
        </div>
        <Flex gap="2" align="center" wrap="wrap">
          <label className="d-flex align-items-center gap-1">
            <Text>Filter:</Text>
            <select
              className="form-control form-control-sm"
              value={scope}
              onChange={(e) => {
                const v = e.target.value as typeof scope;
                setScope(v);
                setLoading(true);
                void (async () => {
                  const q = new URLSearchParams({ limit: "25" });
                  if (v) q.set("scope", v);
                  const res = await apiCall<ListRes>(
                    `/notifications?${q.toString()}`,
                  );
                  setItems(res.notifications);
                  setHasMore(res.hasMore);
                  setNextCursor(res.nextCursor);
                  setLoading(false);
                })();
              }}
            >
              <option value="">All</option>
              <option value="user">Watching</option>
              <option value="org">Organization</option>
              <option value="project">Project</option>
            </select>
          </label>
          <WhiteButton
            variant="outline"
            size="sm"
            onClick={() => void onMarkAllRead()}
          >
            Mark all read
          </WhiteButton>
        </Flex>
      </Flex>

      {items.length === 0 ? (
        <Text color="text-low">No notifications yet.</Text>
      ) : (
        <table className="table appbox gbtable">
          <thead>
            <tr>
              <th>When</th>
              <th>Message</th>
              <th>Scope</th>
              <th style={{ width: 160 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((n) => (
              <tr
                key={n.id}
                className={clsx(
                  n.readAt ? pageStyles.rowRead : pageStyles.rowUnread,
                )}
              >
                <td>
                  <Text>{new Date(n.dateCreated).toLocaleString()}</Text>
                </td>
                <td>
                  <Text weight={n.readAt ? "regular" : "semibold"}>
                    {n.title}
                  </Text>
                  {n.body ? (
                    <Text
                      as="div"
                      className={
                        n.readAt ? pageStyles.mutedBody : pageStyles.bodyUnread
                      }
                    >
                      {n.body}
                    </Text>
                  ) : null}
                </td>
                <td>
                  <Text>{n.scope ?? "—"}</Text>
                </td>
                <td>
                  <Link
                    href={hrefFor(n)}
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => void onMarkRead(n)}
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {hasMore && nextCursor ? (
        <Flex justify="center" mt="4">
          <WhiteButton
            variant="outline"
            onClick={() => {
              void onLoadMore();
            }}
          >
            Load more
          </WhiteButton>
        </Flex>
      ) : null}
    </Box>
  );
};

export default NotificationsPage;
