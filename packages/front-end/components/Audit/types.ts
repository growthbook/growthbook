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
  /** `post` of the last entry in the group. */
  postSnapshot: T;
  /** How many raw entries were merged together. */
  count: number;
}

export interface AuditDiffSection<T> {
  label: string;
  keys: (keyof T)[];
  /**
   * Optional custom renderer. When provided, its output is displayed *above*
   * the raw JSON ExpandableDiff — the diff is always shown regardless.
   * Leave undefined for now; implement per-section renders later.
   */
  render?: (pre: Partial<T> | null, post: Partial<T>) => ReactNode;
}

export interface AuditDiffConfig<T> {
  entityType: EntityType;
  /** Allowlist of audit event strings to display. Everything else is filtered out. */
  includedEvents: string[];
  sections?: AuditDiffSection<T>[];
  defaultGroupBy?: GroupByOption;
}

export interface AuditDiffItem {
  label: string;
  a: string;
  b: string;
  customRender?: ReactNode;
}
