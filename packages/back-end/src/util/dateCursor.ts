import { ReqContext } from "back-end/types/request";

export type DateCursor = { date: Date; seen: string[] };

// A date-time, or a cursor "<date-time>_<ids>" listing the entries already
// returned at that time, so ties at a page boundary aren't lost.
export function parseDateCursor(
  context: ReqContext,
  value?: string,
): DateCursor | null {
  if (!value) return null;
  const sep = value.indexOf("_");
  const date = new Date(sep === -1 ? value : value.slice(0, sep));
  if (isNaN(date.getTime())) context.throwBadRequestError("Invalid cursor");
  return { date, seen: sep === -1 ? [] : value.slice(sep + 1).split(",") };
}

// Wrapped in $or so it composes with other dateCreated filters
export function dateCursorFilter(cursor: DateCursor | null | undefined) {
  if (!cursor) return {};
  const unseenAtDate = cursor.seen.length
    ? [{ dateCreated: cursor.date, id: { $nin: cursor.seen } }]
    : [];
  return { $or: [{ dateCreated: { $lt: cursor.date } }, ...unseenAtDate] };
}

// A full page may have more behind it; a short one is the end.
export function getNextDateCursor(
  page: { id: string; dateCreated: Date }[],
  limit: number,
  cursor: DateCursor | null | undefined,
) {
  if (!page.length || page.length < limit) return null;
  const date = page[page.length - 1].dateCreated;
  const seen = page
    .filter((e) => e.dateCreated.getTime() === date.getTime())
    .map((e) => e.id);
  if (cursor?.date.getTime() === date.getTime()) seen.push(...cursor.seen);
  return `${date.toISOString()}_${seen.join(",")}`;
}
