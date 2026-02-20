import format from "date-fns/format";
import {
  AuditDiffConfig,
  AuditEventMarker,
  CoarsenedAuditEntry,
  GroupByOption,
} from "./types";

// ---- Types ----

export type NoiseItem = {
  type: "noise";
  /** Date of the first (most recent) item in this group. */
  date: Date;
  hiddenCount: number;
  /** Per-event-type marker rollups, in insertion order. */
  markers: { event: string; label: string; count: number }[];
};

export type LeftColItem<T> =
  | { type: "entry"; entry: CoarsenedAuditEntry<T> }
  | NoiseItem
  | { type: "marker"; marker: AuditEventMarker };

// ---- Pure functions ----

// Opaque key for date separator bucket detection; when it changes between adjacent items a separator is injected.
// "minute" and "hour" both use hour-level separators.
export function getSeparatorBucketKey(
  date: Date,
  groupBy: GroupByOption,
): string {
  return format(date, groupBy === "day" ? "yyyy-MM-dd" : "yyyy-MM-dd-HH");
}

// Display text for a date separator, e.g. "Jan 25" or "Jan 25, 2024".
export function getSeparatorLabel(date: Date): string {
  const isCurrentYear = date.getFullYear() === new Date().getFullYear();
  return format(date, isCurrentYear ? "MMM d" : "MMM d, yyyy");
}

// Expand [endpointA, endpointB] to the full ordered slice of all entries between them.
export function expandSelectionRange(
  flatIds: string[],
  selectedIds: string[],
): string[] {
  if (selectedIds.length < 2)
    return flatIds.filter((id) => selectedIds.includes(id));
  const i0 = flatIds.indexOf(selectedIds[0]);
  const i1 = flatIds.indexOf(selectedIds[1]);
  if (i0 === -1 || i1 === -1)
    return flatIds.filter((id) => selectedIds.includes(id));
  return flatIds.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
}

// Build adjacent [older, newer] step pairs from a selected range (newest pair first).
export function buildSteps(selectedSorted: string[]): [string, string][] {
  const ascending = [...selectedSorted].reverse();
  const pairs: [string, string][] = [];
  for (let i = 0; i < ascending.length - 1; i++) {
    pairs.push([ascending[i], ascending[i + 1]]);
  }
  return pairs.reverse();
}

// Compute a human-readable label for a diffable entry.
export function resolveEntryLabel<T>(
  entry: CoarsenedAuditEntry<T>,
  config: AuditDiffConfig<T>,
  eventLabels: Record<string, string>,
  entrySectionLabels: Map<string, string[]>,
): string {
  if (config.overrideEventLabel) {
    const override = config.overrideEventLabel(entry);
    if (override !== null) return override;
  }
  const base = eventLabels[entry.event] ?? entry.event;
  const isUpdateEvent =
    !config.updateEventNames || config.updateEventNames.includes(entry.event);
  if (isUpdateEvent) {
    const hiddenLabelSections = new Set(config.hiddenLabelSections ?? []);
    const sections = (entrySectionLabels.get(entry.id) ?? []).filter(
      (s) => !hiddenLabelSections.has(s),
    );
    return sections.length ? `${base}: ${sections.join(", ")}` : base;
  }
  return config.entityLabel ? `${base} ${config.entityLabel}` : base;
}

// Build the merged, noise-coarsened left-column item list from entries and markers.
export function buildLeftColumnItems<T>(
  flatEntries: CoarsenedAuditEntry<T>[],
  markers: AuditEventMarker[],
  entrySectionLabels: Map<string, string[]>,
  sectionLabels: string[],
  isSectionVisible: (label: string) => boolean,
  selectedIds: string[],
  config: AuditDiffConfig<T>,
): LeftColItem<T>[] {
  type MergedItem =
    | { date: Date; kind: "entry"; entry: CoarsenedAuditEntry<T> }
    | { date: Date; kind: "marker"; marker: AuditEventMarker };

  const merged: MergedItem[] = [
    ...flatEntries.map(
      (entry): MergedItem => ({ date: entry.dateStart, kind: "entry", entry }),
    ),
    ...markers.map(
      (marker): MergedItem => ({ date: marker.date, kind: "marker", marker }),
    ),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const items: LeftColItem<T>[] = [];
  const selectedEndpoints = new Set(selectedIds);

  type NoiseGroup = {
    monthBucket: string;
    date: Date;
    hiddenCount: number;
    markersByEvent: Map<string, { label: string; count: number }>;
    markerEventOrder: string[];
  };
  let noise: NoiseGroup | null = null;

  const getMonthBucket = (date: Date) => format(date, "yyyy-MM");

  const flushNoise = () => {
    if (!noise) return;
    items.push({
      type: "noise",
      date: noise.date,
      hiddenCount: noise.hiddenCount,
      markers: noise.markerEventOrder.map((ev) => ({
        event: ev,
        label: noise!.markersByEvent.get(ev)!.label,
        count: noise!.markersByEvent.get(ev)!.count,
      })),
    });
    noise = null;
  };

  for (const item of merged) {
    if (item.kind === "marker") {
      if (item.marker.alwaysVisible) {
        flushNoise();
        items.push({ type: "marker", marker: item.marker });
        continue;
      }
      const bucket = getMonthBucket(item.marker.date);
      if (noise && noise.monthBucket !== bucket) flushNoise();
      if (!noise) {
        noise = {
          monthBucket: bucket,
          date: item.date,
          hiddenCount: 0,
          markersByEvent: new Map(),
          markerEventOrder: [],
        };
      }
      const existing = noise.markersByEvent.get(item.marker.event);
      if (existing) {
        existing.count++;
      } else {
        noise.markersByEvent.set(item.marker.event, {
          label: item.marker.label,
          count: 1,
        });
        noise.markerEventOrder.push(item.marker.event);
      }
      continue;
    }

    const entry = item.entry;
    const changed = entrySectionLabels.get(entry.id);
    const isVisible =
      !sectionLabels.length ||
      !changed?.length ||
      changed.some(isSectionVisible) ||
      selectedEndpoints.has(entry.id) ||
      config.alwaysVisibleEvents?.includes(entry.event);

    if (isVisible) {
      flushNoise();
      items.push({ type: "entry", entry });
    } else {
      const bucket = getMonthBucket(entry.dateStart);
      if (noise && noise.monthBucket !== bucket) flushNoise();
      if (!noise) {
        noise = {
          monthBucket: bucket,
          date: item.date,
          hiddenCount: 0,
          markersByEvent: new Map(),
          markerEventOrder: [],
        };
      }
      noise.hiddenCount++;
    }
  }
  flushNoise();
  return items;
}
