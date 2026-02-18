import { useMemo } from "react";
import isEqual from "lodash/isEqual";
import { AuditDiffConfig, AuditDiffItem, AuditDiffSection } from "./types";

function pickKeys<T>(obj: T | null, keys: (keyof T)[]): Partial<T> | null {
  if (!obj) return null;
  const result: Partial<T> = {};
  for (const k of keys) {
    result[k] = obj[k];
  }
  return result;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function buildDiffItem<T>(
  label: string,
  pre: Partial<T> | null,
  post: Partial<T>,
  section?: AuditDiffSection<T>,
): AuditDiffItem | null {
  if (isEqual(pre, post)) return null;

  const a = stringify(pre);
  const b = stringify(post);

  const customRender = section?.render ? section.render(pre, post) : undefined;

  return { label, a, b, customRender };
}

function computeAuditDiff<T>(
  pre: T | null,
  post: T | null,
  config: AuditDiffConfig<T>,
): AuditDiffItem[] {
  if (!post) return [];

  const sections = config.sections ?? [];

  const claimedKeys = new Set<keyof T>();
  for (const section of sections) {
    for (const k of section.keys) {
      claimedKeys.add(k);
    }
  }

  const diffs: AuditDiffItem[] = [];

  if (sections.length === 0) {
    const item = buildDiffItem(
      "Changes",
      pre as Partial<T> | null,
      post as Partial<T>,
    );
    if (item) diffs.push(item);
    return diffs;
  }

  for (const section of sections) {
    const prePick = pickKeys(pre, section.keys);
    const postPick = pickKeys(post, section.keys);
    if (!postPick) continue;
    const item = buildDiffItem(section.label, prePick, postPick, section);
    if (item) diffs.push(item);
  }

  const otherKeys = (Object.keys(post as object) as (keyof T)[]).filter(
    (k) => !claimedKeys.has(k),
  );
  if (otherKeys.length > 0) {
    const prePick = pickKeys(pre, otherKeys);
    const postPick = pickKeys(post, otherKeys);
    if (postPick) {
      const item = buildDiffItem("Other changes", prePick, postPick);
      if (item) diffs.push(item);
    }
  }

  return diffs;
}

/**
 * Returns the labels of sections that have changes between pre and post.
 * Suitable for use in a useMemo over a list of entries.
 */
export function getChangedSectionLabels<T>(
  pre: T | null,
  post: T | null,
  config: AuditDiffConfig<T>,
): string[] {
  return computeAuditDiff(pre, post, config).map((d) => d.label);
}

export function useAuditDiff<T>({
  pre,
  post,
  config,
}: {
  pre: T | null;
  post: T | null;
  config: AuditDiffConfig<T>;
}): AuditDiffItem[] {
  return useMemo(
    () => computeAuditDiff(pre, post, config),
    [pre, post, config],
  );
}
