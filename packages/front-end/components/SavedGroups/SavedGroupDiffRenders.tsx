import { ReactNode } from "react";
import isEqual from "lodash/isEqual";
import { SavedGroupInterface } from "shared/types/saved-group";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import Text from "@/ui/Text";
import {
  ChangeField,
  toConditionString,
  renderFallback,
  ProjectName,
} from "@/components/AuditHistoryExplorer/DiffRenderUtils";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";

type Pre = Partial<SavedGroupInterface> | null;
type Post = Partial<SavedGroupInterface>;

// Max items to render inline before switching to a count-only summary.
const INLINE_LIMIT = 200;

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

// ─── Section renders ─────────────────────────────────────────────────────────

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

  const rows: ReactNode[] = [
    <ChangeField
      key="condition"
      label="Condition"
      changed
      oldNode={
        !preEmpty ? <ConditionDisplay condition={preStr!} /> : <em>None</em>
      }
      newNode={
        !postEmpty ? <ConditionDisplay condition={postStr!} /> : <em>None</em>
      }
    />,
  ];

  rows.push(
    ...renderFallback(
      pre as Record<string, unknown>,
      post as Record<string, unknown>,
      new Set(["condition"]),
    ),
  );

  return <div className="mt-1">{rows}</div>;
}

// Shows values array and attributeKey for list-type saved groups.
// Falls back to a count summary when either side exceeds INLINE_LIMIT.
export function renderSavedGroupValues(pre: Pre, post: Post): ReactNode | null {
  const rows: ReactNode[] = [];

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

  rows.push(
    ...renderFallback(
      pre as Record<string, unknown>,
      post as Record<string, unknown>,
      new Set(["attributeKey", "values"]),
    ),
  );

  return rows.length ? <div className="mt-1">{rows}</div> : null;
}

// "Settings" — name and any other metadata.
// groupName is explicit because camelToLabel gives "Group Name", not "Name".
export function renderSavedGroupSettings(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const rows: ReactNode[] = [];

  if (
    !isEqual(pre?.groupName, post.groupName) &&
    post.groupName !== undefined
  ) {
    rows.push(
      <ChangeField
        key="groupName"
        label="Name"
        changed
        oldNode={pre?.groupName ?? <em>None</em>}
        newNode={post.groupName}
      />,
    );
  }

  rows.push(
    ...renderFallback(
      pre as Record<string, unknown>,
      post as Record<string, unknown>,
      new Set(["groupName"]),
    ),
  );

  return rows.length ? <div className="mt-1">{rows}</div> : null;
}

// "Projects" — projects array with resolved names.
export function renderSavedGroupProjects(
  pre: Pre,
  post: Post,
): ReactNode | null {
  if (isEqual(pre?.projects, post.projects)) return null;
  const preProjects = pre?.projects ?? [];
  const postProjects = post.projects ?? [];
  if (!preProjects.length && !postProjects.length) return null;

  const rows: ReactNode[] = [
    <ChangeField
      key="projects"
      label="Projects"
      changed
      oldNode={
        preProjects.length ? (
          <>
            {preProjects.map((id, i) => (
              <span key={id}>
                {i > 0 ? ", " : ""}
                <ProjectName id={id} />
              </span>
            ))}
          </>
        ) : (
          <em>None</em>
        )
      }
      newNode={
        postProjects.length ? (
          <>
            {postProjects.map((id, i) => (
              <span key={id}>
                {i > 0 ? ", " : ""}
                <ProjectName id={id} />
              </span>
            ))}
          </>
        ) : (
          <em>None</em>
        )
      }
    />,
  ];

  rows.push(
    ...renderFallback(
      pre as Record<string, unknown>,
      post as Record<string, unknown>,
      new Set(["projects"]),
    ),
  );

  return <div className="mt-1">{rows}</div>;
}

// ─── Badge getters ────────────────────────────────────────────────────────────

export function getSavedGroupSettingsBadges(pre: Pre, post: Post): DiffBadge[] {
  const badges: DiffBadge[] = [];
  if (!isEqual(pre?.groupName, post.groupName) && post.groupName !== undefined)
    badges.push({ label: "Edit name", action: "edit name" });
  if (!isEqual(pre?.owner, post.owner) && post.owner !== undefined)
    badges.push({ label: "Edit owner", action: "edit owner" });
  if (
    !isEqual(pre?.description, post.description) &&
    post.description !== undefined
  )
    badges.push({ label: "Edit description", action: "edit description" });
  return badges;
}

export function getSavedGroupTargetingBadges(): DiffBadge[] {
  return [{ label: "Edit targeting", action: "edit targeting" }];
}

export function getSavedGroupValuesBadges(pre: Pre, post: Post): DiffBadge[] {
  const badges: DiffBadge[] = [];
  if (
    !isEqual(pre?.attributeKey, post.attributeKey) &&
    post.attributeKey !== undefined
  )
    badges.push({ label: "Edit attribute", action: "edit attribute" });
  const preVals = (pre?.values ?? []) as string[];
  const postVals = (post.values ?? []) as string[];
  if (!isEqual(preVals, postVals)) {
    const diff = postVals.length - preVals.length;
    if (diff > 0)
      badges.push({
        label: `+${diff} value${diff !== 1 ? "s" : ""}`,
        action: "add values",
      });
    else if (diff < 0)
      badges.push({
        label: `−${Math.abs(diff)} value${Math.abs(diff) !== 1 ? "s" : ""}`,
        action: "remove values",
      });
    else badges.push({ label: "Edit values", action: "edit values" });
  }
  return badges;
}

export function getSavedGroupProjectsBadges(pre: Pre, post: Post): DiffBadge[] {
  const preProjects = pre?.projects ?? [];
  const postProjects = post.projects ?? [];
  const added = postProjects.filter((id) => !preProjects.includes(id));
  const removed = preProjects.filter((id) => !postProjects.includes(id));
  const badges: DiffBadge[] = [];
  if (added.length)
    badges.push({
      label: `+${added.length} project${added.length !== 1 ? "s" : ""}`,
      action: "add project",
    });
  if (removed.length)
    badges.push({
      label: `−${removed.length} project${removed.length !== 1 ? "s" : ""}`,
      action: "remove project",
    });
  return badges.length
    ? badges
    : [{ label: "Edit projects", action: "edit projects" }];
}
