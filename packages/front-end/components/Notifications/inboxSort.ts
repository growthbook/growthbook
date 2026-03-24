/**
 * Inbox-style ordering for a small preview list: unread first, then newest-first
 * within unread and within read. Safe for panel previews; full-page paginated lists
 * should rely on API order unless the backend supports unread-first pagination.
 */
export function sortInboxNotifications<
  T extends { readAt: string | null; dateCreated: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aUnread = a.readAt == null;
    const bUnread = b.readAt == null;
    if (aUnread !== bUnread) return aUnread ? -1 : 1;
    return (
      new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime()
    );
  });
}
