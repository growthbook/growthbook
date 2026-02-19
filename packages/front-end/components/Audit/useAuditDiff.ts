import { useMemo } from "react";
import isEqual from "lodash/isEqual";
import { AuditDiffConfig, AuditDiffItem, AuditDiffSection } from "./types";

function stripArraySubKeys(value: unknown, subKeys: string[]): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (typeof item !== "object" || item === null) return item;
    const copy = { ...item } as Record<string, unknown>;
    for (const k of subKeys) delete copy[k];
    return copy;
  });
}

function pickSubKeysFromArray(value: unknown, subKeys: string[]): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (typeof item !== "object" || item === null) return item;
    const result: Record<string, unknown> = {};
    for (const k of subKeys) {
      if (k in (item as object))
        result[k] = (item as Record<string, unknown>)[k];
    }
    return result;
  });
}

function pickKeys<T>(
  obj: T | null,
  keys: (keyof T)[],
  stripSubKeys?: string[],
  pickSubKeys?: string[],
): Partial<T> | null {
  if (!obj) return null;
  const result: Partial<T> = {};
  for (const k of keys) {
    if (Array.isArray(obj[k])) {
      if (pickSubKeys) {
        result[k] = pickSubKeysFromArray(obj[k], pickSubKeys) as T[keyof T];
      } else if (stripSubKeys) {
        result[k] = stripArraySubKeys(obj[k], stripSubKeys) as T[keyof T];
      } else {
        result[k] = obj[k];
      }
    } else {
      result[k] = obj[k];
    }
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
    const prePick = pickKeys(
      pre,
      section.keys,
      section.stripSubKeys,
      section.pickSubKeys,
    );
    const postPick = pickKeys(
      post,
      section.keys,
      section.stripSubKeys,
      section.pickSubKeys,
    );
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
      const item = buildDiffItem("other changes", prePick, postPick);
      if (item) diffs.push(item);
    }
  }

  // Companion diffs: for sections with stripSubKeysLabel, emit a separate diff
  // containing only the stripped sub-keys. Multiple sections sharing the same
  // label and key are merged. The companion starts collapsed and is always
  // rendered regardless of section visibility filters.
  const companionGroups = new Map<string, Map<keyof T, Set<string>>>();
  for (const section of sections) {
    if (!section.stripSubKeysLabel || !section.stripSubKeys?.length) continue;
    const label = section.stripSubKeysLabel;
    if (!companionGroups.has(label)) companionGroups.set(label, new Map());
    const keyMap = companionGroups.get(label)!;
    for (const k of section.keys) {
      if (!keyMap.has(k)) keyMap.set(k, new Set());
      for (const sk of section.stripSubKeys) keyMap.get(k)!.add(sk);
    }
  }
  for (const [label, keyMap] of companionGroups) {
    const preObj: Partial<T> = {};
    const postObj: Partial<T> = {};
    for (const [k, subKeySet] of keyMap) {
      const subKeys = Array.from(subKeySet);
      (preObj as Record<string, unknown>)[k as string] = pickSubKeysFromArray(
        pre?.[k],
        subKeys,
      );
      (postObj as Record<string, unknown>)[k as string] = pickSubKeysFromArray(
        post[k],
        subKeys,
      );
    }
    const item = buildDiffItem(label, preObj, postObj);
    if (item)
      diffs.push({ ...item, defaultCollapsed: true, isCompanion: true });
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
  return computeAuditDiff(pre, post, config)
    .filter((d) => !d.isCompanion)
    .map((d) => d.label);
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
