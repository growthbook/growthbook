import { ReactNode, useMemo, useState } from "react";
import isEqual from "lodash/isEqual";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";

// Standalone types (not from audit system)
export interface RevisionDiffSection<T> {
  label: string;
  keys: (keyof T)[];
  render: (pre: Partial<T> | null, post: Partial<T>) => ReactNode | null;
  getBadges?: (pre: Partial<T> | null, post: Partial<T>) => DiffBadge[];
  suppressCardLabel?: boolean;
}

export interface RevisionDiffConfig<T> {
  sections: RevisionDiffSection<T>[];
  normalizeSnapshot?: (snapshot: T) => T;
}

interface RevisionDiffItem {
  label: string;
  a: string; // JSON string for old value
  b: string; // JSON string for new value
  customRender?: ReactNode;
  customBadges?: DiffBadge[];
  suppressCardLabel?: boolean;
}

// Helper: Extract only specified keys from object
function pickKeys<T>(obj: T | null, keys: (keyof T)[]): Partial<T> | null {
  if (!obj) return null;
  const result: Partial<T> = {};
  for (const k of keys) {
    result[k] = obj[k];
  }
  return result;
}

// Helper: Convert value to JSON string
function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

// Core diff computation
function computeDiff<T>(
  pre: T | null,
  post: T,
  config: RevisionDiffConfig<T>,
): RevisionDiffItem[] {
  const diffs: RevisionDiffItem[] = [];

  for (const section of config.sections) {
    const prePick = pickKeys(pre, section.keys);
    const postPick = pickKeys(post, section.keys);

    if (isEqual(prePick, postPick)) continue; // No changes in this section

    const customRender = postPick ? section.render(prePick, postPick) : null;
    if (customRender == null) continue; // Render returned null, skip section

    const customBadges =
      section.getBadges && postPick
        ? section.getBadges(prePick, postPick)
        : undefined;

    diffs.push({
      label: section.label,
      a: stringify(prePick),
      b: stringify(postPick),
      customRender,
      customBadges,
      suppressCardLabel: section.suppressCardLabel,
    });
  }

  return diffs;
}

// Custom hook for revision diffs
export function useRevisionDiff<T>(
  pre: T | null,
  post: T,
  config: RevisionDiffConfig<T>,
) {
  // Normalize snapshots
  const normalizedPre = useMemo(() => {
    if (!pre || !config.normalizeSnapshot) return pre;
    return config.normalizeSnapshot(pre);
  }, [pre, config]);

  const normalizedPost = useMemo(() => {
    if (!config.normalizeSnapshot) return post;
    return config.normalizeSnapshot(post);
  }, [post, config]);

  // Compute diffs
  const diffs = useMemo(() => {
    return computeDiff<T>(normalizedPre, normalizedPost, config);
  }, [normalizedPre, normalizedPost, config]);

  // Section visibility state
  const sectionLabels = useMemo(() => {
    return config.sections.map((s) => s.label);
  }, [config.sections]);

  const [visibleSections, setVisibleSections] = useState<Set<string>>(
    () => new Set(sectionLabels),
  );

  const isSectionVisible = (label: string) => visibleSections.has(label);

  // Extract badges from diffs
  const badges = useMemo(() => {
    return diffs.flatMap((d) => d.customBadges || []);
  }, [diffs]);

  // Group custom renders by section
  const customRenderGroups = useMemo(() => {
    return diffs.map((d) => ({
      label: d.label,
      renders: [d.customRender],
      suppressCardLabel: d.suppressCardLabel ?? false,
    }));
  }, [diffs]);

  return {
    diffs,
    sectionLabels,
    visibleSections,
    setVisibleSections,
    isSectionVisible,
    badges,
    customRenderGroups,
  };
}
