import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import router from "next/router";
import clsx from "clsx";
import { PiBell } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import Text from "@/ui/Text";
import { Popover } from "@/ui/Popover";
import { WhiteButton } from "@/ui/Button";
import {
  trackNotificationDeepLinkClicked,
  trackNotificationDismissed,
  trackNotificationPanelOpened,
  trackNotificationRead,
  trackNotificationShowAllClicked,
} from "@/services/track";
import styles from "./NotificationInboxBell.module.scss";
import { sortInboxNotifications } from "./inboxSort";

type ApiNotification = {
  id: string;
  title: string;
  body?: string;
  resourceType: string;
  resourceId: string;
  seenAt: string | null;
  readAt: string | null;
  dateCreated: string;
};

type Counts = { unread: number; unseen: number };

const POLL_MS = 45_000;

export const NotificationInboxBell: FC = () => {
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const markedSeenRef = useRef<Set<string>>(new Set());

  const refreshCounts = useCallback(async () => {
    try {
      const c = await apiCall<Counts>("/notifications/counts");
      setCounts(c);
    } catch {
      // ignore when feature off or network error
    }
  }, [apiCall]);

  const loadPanel = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiCall<{
        notifications: ApiNotification[];
        hasMore: boolean;
      }>("/notifications?limit=15");
      setItems(res.notifications);
      setHasMore(res.hasMore);
      const ids = res.notifications
        .map((n) => n.id)
        .filter((id) => !markedSeenRef.current.has(id));
      if (ids.length) {
        ids.forEach((id) => markedSeenRef.current.add(id));
        await apiCall("/notifications/seen", {
          method: "POST",
          body: JSON.stringify({ ids }),
        });
        await refreshCounts();
      }
    } finally {
      setLoading(false);
    }
  }, [apiCall, refreshCounts]);

  useEffect(() => {
    void refreshCounts();
    const t = window.setInterval(() => void refreshCounts(), POLL_MS);
    const onFocus = () => void refreshCounts();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshCounts]);

  useEffect(() => {
    if (open) {
      trackNotificationPanelOpened();
      void loadPanel();
    }
  }, [open, loadPanel]);

  // if (!gb?.isOn("in-app-notifications")) {
  //   return null;
  // }

  const badge = counts?.unseen ?? 0;

  const panelItems = useMemo(() => sortInboxNotifications(items), [items]);

  const hrefFor = (n: ApiNotification) => {
    const type = (n.resourceType || "").toLowerCase();
    if (type === "feature") {
      return `/features/${encodeURIComponent(n.resourceId)}`;
    }
    if (type === "experiment") {
      return `/experiment/${encodeURIComponent(n.resourceId)}`;
    }
    if (type === "organization") {
      return "/settings";
    }
    return "/";
  };

  const onRowNavigate = (n: ApiNotification, href: string) => {
    setOpen(false);
    trackNotificationDeepLinkClicked({ resourceType: n.resourceType });
    void router.push(href);
    void (async () => {
      try {
        await apiCall(`/notifications/${n.id}/read`, { method: "POST" });
        trackNotificationRead("single", { id: n.id });
        const readAt = new Date().toISOString();
        setItems((prev) =>
          prev.map((x) => (x.id === n.id ? { ...x, readAt } : x)),
        );
        await refreshCounts();
      } catch {
        // ignore
      }
    })();
  };

  const onDismiss = async (e: React.MouseEvent, n: ApiNotification) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await apiCall(`/notifications/${n.id}/dismiss`, { method: "POST" });
      trackNotificationDismissed({ id: n.id });
      setItems((prev) => prev.filter((x) => x.id !== n.id));
      await refreshCounts();
    } catch {
      // ignore
    }
  };

  const onMarkAllRead = async () => {
    try {
      await apiCall("/notifications/read-all", { method: "POST" });
      trackNotificationRead("mark_all", {});
      setItems((prev) =>
        prev.map((n) => ({ ...n, readAt: new Date().toISOString() })),
      );
      await refreshCounts();
    } catch {
      // ignore
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      showArrow={false}
      trigger={
        <button
          type="button"
          className={styles.bellButton}
          aria-label="Notifications"
        >
          <PiBell size={22} />
          {badge > 0 ? (
            <span className={styles.badge}>{badge > 99 ? "99+" : badge}</span>
          ) : null}
        </button>
      }
      content={
        <Box className={styles.panel}>
          <div className={styles.headerRow}>
            <Text weight="semibold" className={styles.headerTitle}>
              Notifications
            </Text>
            {items.some((n) => !n.readAt) ? (
              <div className={styles.markAllWrap}>
                <WhiteButton
                  size="sm"
                  variant="outline"
                  onClick={() => void onMarkAllRead()}
                >
                  Mark all read
                </WhiteButton>
              </div>
            ) : null}
          </div>
          {loading ? (
            <Text color="text-low">Loading…</Text>
          ) : items.length === 0 ? (
            <Text color="text-low">You&apos;re all caught up.</Text>
          ) : (
            <ul className={styles.list}>
              {panelItems.map((n) => (
                <li
                  key={n.id}
                  className={clsx(
                    styles.row,
                    n.readAt ? styles.rowRead : styles.rowUnread,
                  )}
                >
                  <Link
                    href={hrefFor(n)}
                    className={styles.rowLink}
                    onClick={(e) => {
                      if (
                        e.metaKey ||
                        e.ctrlKey ||
                        e.shiftKey ||
                        e.altKey ||
                        e.button !== 0
                      ) {
                        return;
                      }
                      e.preventDefault();
                      onRowNavigate(n, hrefFor(n));
                    }}
                  >
                    <div>
                      <Text
                        weight={n.readAt ? "regular" : "semibold"}
                        className={
                          n.readAt ? styles.titleRead : styles.titleUnread
                        }
                      >
                        {n.title}
                      </Text>
                      {n.body ? (
                        <Text
                          size="small"
                          className={clsx(
                            styles.body,
                            n.readAt ? styles.bodyRead : styles.bodyUnread,
                          )}
                        >
                          {n.body}
                        </Text>
                      ) : null}
                    </div>
                  </Link>
                  <button
                    type="button"
                    className={styles.dismiss}
                    aria-label="Dismiss"
                    onClick={(e) => void onDismiss(e, n)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!loading ? (
            <Flex direction="column" align="center" gap="2" mt="3">
              {hasMore && items.length > 0 ? (
                <Text size="small" color="text-low" align="center">
                  Showing the most recent {items.length}. Older notifications
                  are on the full inbox.
                </Text>
              ) : null}
              <Link
                href="/notifications"
                className="btn btn-sm btn-outline-primary"
                onClick={() => {
                  trackNotificationShowAllClicked();
                  setOpen(false);
                }}
              >
                Show all
              </Link>
            </Flex>
          ) : null}
        </Box>
      }
      contentStyle={{ padding: "12px 16px" }}
      contentClassName={styles.popoverContent}
    />
  );
};
