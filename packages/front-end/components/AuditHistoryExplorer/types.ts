import { ReactNode } from "react";
import { EntityType } from "shared/types/audit";

export type GroupByOption = "minute" | "hour" | "day";

export interface AuditUserInfo {
  type: "user" | "apikey" | "system";
  id?: string;
  email?: string;
  name?: string;
  apiKey?: string;
}

/** A single item displayed in the left-column list. May represent 1 or N raw audit entries that were coarsened into a single group (same time bucket + same author). */
export interface CoarsenedAuditEntry<T> {
  /** The first raw entry's id — stable React key. */
  id: string;
  /** Raw ids of all entries merged into this group. */
  rawIds: string[];
  /** Event name of the last entry in the group (most representative). */
  event: string;
  dateStart: Date;
  dateEnd: Date;
  user: AuditUserInfo;
  /** `pre` of the first entry in the group. null for create events. */
  preSnapshot: T | null;
  /**
   * `post` of the last entry in the group. null when snapshot data could not
   * be parsed — these entries are surfaced in the left column with a warning
   * icon rather than being silently dropped.
   */
  postSnapshot: T | null;
  /** How many raw entries were merged together. */
  count: number;
  /**
   * Per-raw-entry snapshots for the group. Used to compute the union of
   * changed sections across all sub-events for the left-column title (so
   * sections that cancel out net-wise still appear in the label).
   */
  rawSnapshots: Array<{ pre: T | null; post: T | null }>;
}

export interface AuditDiffSection<T> {
  label: string;
  keys: (keyof T)[];
  /**
   * When set, array-valued keys are filtered to include *only* these sub-keys
   * in the main diff. Takes precedence over stripSubKeys for the main diff.
   * Use this to restrict a section to its exact fields when multiple sections
   * claim the same parent key (e.g. phases[]).
   */
  pickSubKeys?: string[];
  /**
   * Sub-keys to strip from each element when a claimed key holds an array of
   * objects. When pickSubKeys is set this only affects companion diff
   * generation (see stripSubKeysLabel). Otherwise it also strips from the
   * main diff.
   */
  stripSubKeys?: string[];
  /**
   * When set, a companion diff item is generated containing *only* the
   * stripped sub-keys, labelled with this string (e.g. "Phases: other
   * changes"). Multiple sections sharing the same label and key are merged
   * into a single companion item. The companion starts collapsed and is
   * always rendered regardless of section visibility filters.
   */
  stripSubKeysLabel?: string;
  /**
   * Optional custom renderer. When provided, its output is displayed *above*
   * the raw JSON ExpandableDiff — the diff is always shown regardless.
   * Leave undefined for now; implement per-section renders later.
   */
  render?: (pre: Partial<T> | null, post: Partial<T>) => ReactNode;
}

/**
 * A non-selectable timeline marker for events that carry no diffable snapshot
 * (e.g. experiment.refresh). Shown in the left column as a plain text label.
 */
export interface AuditEventMarker {
  id: string;
  event: string;
  date: Date;
  user: AuditUserInfo;
  label: string;
  /** When true the marker is always rendered inline and never collapsed into a noise group. */
  alwaysVisible?: boolean;
}

export interface AuditDiffConfig<T> {
  entityType: EntityType;
  /** Allowlist of audit event strings to display. Everything else is filtered out. */
  includedEvents: string[];
  sections?: AuditDiffSection<T>[];
  defaultGroupBy?: GroupByOption;
  /**
   * Human-readable entity name appended to non-update event labels.
   * E.g. "Experiment" → "Created Experiment", "Archived Experiment".
   */
  entityLabel?: string;
  /**
   * Events that show changed-section suffixes in their title (e.g. "Updated: Metrics").
   * All other events use entityLabel instead of section suffixes.
   * If omitted, section suffixes are shown for all events.
   */
  updateEventNames?: string[];
  /**
   * Optional per-entry label override. Return a string to replace the default
   * label entirely, or null to fall through to the default logic.
   */
  overrideEventLabel?: (entry: CoarsenedAuditEntry<T>) => string | null;
  /**
   * Optional view-only snapshot transform applied JIT before diffing.
   * Use this to parse embedded JSON strings (e.g. condition fields) into
   * objects so the diff viewer renders them as structured diffs.
   * The original snapshot record is never mutated.
   */
  normalizeSnapshot?: (snapshot: T) => T;
  /**
   * Diffable events that are always rendered in the left column regardless of
   * active section filters (e.g. archive/unarchive events whose changed field
   * isn't claimed by any section).
   */
  alwaysVisibleEvents?: string[];
  /**
   * When true, any event prefixed with `${entityType}.` that is not listed in
   * includedEvents or labelOnlyEvents is automatically surfaced as a label-only
   * marker (non-diffable). The label is derived from the event name by splitting
   * on dots/camelCase. Useful for forward-compatibility with future event types.
   */
  catchUnknownEventsAsLabels?: boolean;
  /** Events to silently drop — never shown in the list, even when catchUnknownEventsAsLabels is true. */
  ignoredEvents?: string[];
  /**
   * Events that carry no diffable experiment snapshot (e.g. experiment.refresh).
   * These are fetched alongside diffable events but shown as plain non-selectable
   * text labels in the left column rather than comparison entries.
   */
  labelOnlyEvents?: {
    event: string;
    getLabel: (details: Record<string, unknown> | null) => string;
    /** When true the marker is always shown inline and never collapsed into a noise group. */
    alwaysVisible?: boolean;
  }[];
  /** Section labels hidden by default in the filter dropdown. */
  defaultHiddenSections?: string[];
  /** Section labels suppressed from left-column entry title suffixes (too noisy or redundant). */
  hiddenLabelSections?: string[];
  /**
   * When true, the filter/group-by dropdown is hidden entirely.
   * Sections are still used for diff grouping and left-column labels.
   */
  hideFilters?: boolean;
}

export interface AuditDiffItem {
  label: string;
  a: string;
  b: string;
  customRender?: ReactNode;
  /** When true the ExpandableDiff starts collapsed regardless of section visibility. */
  defaultCollapsed?: boolean;
  /**
   * Companion diffs are always rendered on the right side but are excluded
   * from left-column title and entry visibility calculations.
   */
  isCompanion?: boolean;
}
