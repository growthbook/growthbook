import React, { ReactNode, ReactElement } from "react";
import isEqual from "lodash/isEqual";
import { useDefinitions } from "@/services/DefinitionsContext";
import Text from "@/ui/Text";

// After normalizeSnapshot, `condition` may already be a parsed object.
// ConditionDisplay expects a JSON string, so re-stringify if needed.
export function toConditionString(cond: unknown): string | undefined {
  if (!cond) return undefined;
  if (typeof cond === "string") return cond;
  return JSON.stringify(cond);
}

// Converts camelCase key to a human-readable label ("hashAttribute" → "Hash Attribute").
// "Id" at a word boundary is uppercased to "ID" ("exposureQueryId" → "Exposure Query ID").
export function camelToLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/\bId\b/g, "ID")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

// Labeled Δ old → new row; renders nothing when changed=false.
export function ChangeField({
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

// Stacked before/after display for multi-line text. Each value in a scrollable box.
export function TextChangedField({
  label,
  pre,
  post,
}: {
  label: string;
  pre: string | null | undefined;
  post: string | null | undefined;
}) {
  if (isEqual(pre, post)) return null;

  const TextBox = ({
    value,
    marker,
    colorClass,
  }: {
    value: string | null | undefined;
    marker: string;
    colorClass: string;
  }) => (
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
          maxHeight: 90,
          overflowY: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: "var(--font-size-1)",
          lineHeight: 1.5,
        }}
      >
        {value || <em className="text-muted">None</em>}
      </div>
    </div>
  );

  return (
    <div className="mb-2">
      <div className="mb-1">
        <Text size="medium" weight="medium" color="text-mid">
          {label}
        </Text>
      </div>
      <TextBox value={pre} marker="Δ" colorClass="text-danger" />
      <TextBox value={post} marker="→" colorClass="text-success" />
    </div>
  );
}

// Before/after row for fields without a dedicated renderer.
// Scalars shown as plain text; objects/arrays as compact JSON.
export function GenericFieldChange({
  fieldKey,
  preVal,
  postVal,
}: {
  fieldKey: string;
  preVal: unknown;
  postVal: unknown;
}) {
  if (isEqual(preVal, postVal)) return null;
  const fmt = (v: unknown): ReactNode => {
    if (v === null || v === undefined) return <em>unset</em>;
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "string" || typeof v === "number") return String(v);
    return (
      <code style={{ fontSize: "var(--font-size-1)", wordBreak: "break-all" }}>
        {JSON.stringify(v)}
      </code>
    );
  };
  return (
    <ChangeField
      label={camelToLabel(fieldKey)}
      changed
      oldNode={fmt(preVal)}
      newNode={fmt(postVal)}
    />
  );
}

// Appends GenericFieldChange rows for unclaimed keys — forward-compat fallback.
export function renderFallback(
  pre: Record<string, unknown> | null | undefined,
  post: Record<string, unknown>,
  handled: Set<string>,
): ReactNode[] {
  return Object.keys(post)
    .filter((k) => !handled.has(k) && !isEqual(pre?.[k], post[k]))
    .map((k) => (
      <GenericFieldChange
        key={k}
        fieldKey={k}
        preVal={pre?.[k]}
        postVal={post[k]}
      />
    ));
}

// Resolves a project ID to its display name. Falls back to the raw ID.
export function ProjectName({ id }: { id: string }): ReactElement {
  const { getProjectById } = useDefinitions();
  return <>{getProjectById(id)?.name ?? id}</>;
}
