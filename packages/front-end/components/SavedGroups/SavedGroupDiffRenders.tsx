/**
 * Human-readable summary renders for SavedGroup AuditDiffSections.
 * Wired as the `render` prop on each section in the saved-group
 * AuditHistoryExplorerModal config.
 */

import React, { ReactNode } from "react";
import isEqual from "lodash/isEqual";
import { SavedGroupInterface } from "shared/types/saved-group";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import Text from "@/ui/Text";

type Pre = Partial<SavedGroupInterface> | null;
type Post = Partial<SavedGroupInterface>;

/** Max items to render inline before switching to a count-only summary. */
const INLINE_LIMIT = 200;

// ─── Shared primitives (mirrors ExperimentDiffRenders) ───────────────────────

function ChangeField({
  label,
  changed,
  oldNode,
  newNode,
}: {
  label: string;
  changed: boolean;
  oldNode: ReactNode;
  newNode: ReactNode;
}) {
  if (!changed) return null;
  return (
    <div className="mb-2">
      <div className="mb-1">
        <Text size="medium" weight="medium" color="text-mid">
          {label}
        </Text>
      </div>
      <div className="d-flex align-items-start">
        <div className="text-danger d-flex align-items-start">
          <div className="text-center mr-2" style={{ width: 16 }}>
            Δ
          </div>
          <div>{oldNode}</div>
        </div>
        <div className="font-weight-bold text-success d-flex align-items-start ml-4">
          <div className="text-center mx-2" style={{ width: 16 }}>
            →
          </div>
          <div>{newNode}</div>
        </div>
      </div>
    </div>
  );
}

function ValuesBox({
  values,
  marker,
  colorClass,
}: {
  values: string[];
  marker: string;
  colorClass: string;
}) {
  return (
    <div className={`d-flex align-items-start mb-1 ${colorClass}`}>
      <div
        className="text-center font-weight-bold mr-2 mt-1"
        style={{ width: 16, flexShrink: 0, lineHeight: "1.6" }}
      >
        {marker}
      </div>
      <div
        style={{
          flex: 1,
          border: "1px solid var(--gray-5)",
          borderRadius: "var(--radius-2)",
          padding: "6px 10px",
          background: "var(--gray-2)",
          maxHeight: 120,
          overflowY: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: "var(--font-size-1)",
          lineHeight: 1.5,
          fontFamily: "var(--font-mono)",
        }}
      >
        {values.length ? (
          values.join("\n")
        ) : (
          <em className="text-muted">None</em>
        )}
      </div>
    </div>
  );
}

/**
 * After normalizeSnapshot, `condition` may already be a parsed object.
 * ConditionDisplay expects a JSON string, so re-stringify if needed.
 */
function toConditionString(cond: unknown): string | undefined {
  if (!cond) return undefined;
  if (typeof cond === "string") return cond;
  return JSON.stringify(cond);
}

// ─── Section renders ─────────────────────────────────────────────────────────

/**
 * "Targeting" – the condition field for condition-type saved groups.
 */
export function renderSavedGroupTargeting(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const condChanged = !isEqual(pre?.condition, post.condition);
  const preStr = toConditionString(pre?.condition);
  const postStr = toConditionString(post.condition);
  const preEmpty = !preStr || preStr === "{}";
  const postEmpty = !postStr || postStr === "{}";
  if (!condChanged || (preEmpty && postEmpty)) return null;

  return (
    <div className="mt-1">
      <ChangeField
        label="Condition"
        changed
        oldNode={
          !preEmpty ? <ConditionDisplay condition={preStr!} /> : <em>None</em>
        }
        newNode={
          !postEmpty ? <ConditionDisplay condition={postStr!} /> : <em>None</em>
        }
      />
    </div>
  );
}

/**
 * "Values" – values array and attributeKey for list-type saved groups.
 *
 * If both pre and post have ≤ INLINE_LIMIT items, show them as scrollable
 * before/after text boxes. Otherwise show a count summary only — we can't
 * cheaply diff 10k-item arrays in-memory, and the truncation in
 * normalizeSnapshot means only the first 100 items are diffed in the raw view.
 */
export function renderSavedGroupValues(pre: Pre, post: Post): ReactNode | null {
  const rows: ReactNode[] = [];

  // ── attributeKey ──────────────────────────────────────────────────────────
  if (!isEqual(pre?.attributeKey, post.attributeKey) && post.attributeKey) {
    rows.push(
      <ChangeField
        key="attrKey"
        label="Attribute key"
        changed
        oldNode={pre?.attributeKey ?? <em>unset</em>}
        newNode={post.attributeKey}
      />,
    );
  }

  // ── values array ──────────────────────────────────────────────────────────
  const preVals = (pre?.values ?? []) as string[];
  const postVals = (post.values ?? []) as string[];
  // Treat undefined and [] as equivalent — no meaningful change.
  const valuesChanged =
    preVals.length > 0 || postVals.length > 0
      ? !isEqual(preVals, postVals)
      : false;

  if (valuesChanged) {
    const preCount = preVals.length;
    const postCount = postVals.length;
    const useInline = preCount <= INLINE_LIMIT && postCount <= INLINE_LIMIT;

    if (useInline) {
      rows.push(
        <div key="values" className="mb-2">
          <div className="mb-1">
            <Text size="medium" weight="medium" color="text-mid">
              Values
            </Text>
          </div>
          <ValuesBox values={preVals} marker="Δ" colorClass="text-danger" />
          <ValuesBox values={postVals} marker="→" colorClass="text-success" />
        </div>,
      );
    } else {
      const countChanged = preCount !== postCount;
      rows.push(
        <ChangeField
          key="values-count"
          label="Values"
          changed
          oldNode={`${preCount.toLocaleString()} item${preCount !== 1 ? "s" : ""}`}
          newNode={
            countChanged
              ? `${postCount.toLocaleString()} item${postCount !== 1 ? "s" : ""}`
              : `${postCount.toLocaleString()} items (content changed)`
          }
        />,
      );
    }
  }

  return rows.length ? <div className="mt-1">{rows}</div> : null;
}
