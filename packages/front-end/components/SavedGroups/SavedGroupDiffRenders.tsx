import { ReactNode } from "react";
import isEqual from "lodash/isEqual";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import { SavedGroupInterface } from "shared/types/saved-group";
import { Box, Flex } from "@radix-ui/themes";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import {
  ChangeField,
  toConditionString,
  renderFallback,
  ProjectName,
  OwnerName,
} from "@/components/AuditHistoryExplorer/DiffRenderUtils";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";

type Pre = Partial<SavedGroupInterface> | null;
type Post = Partial<SavedGroupInterface>;

// Max items to render inline before switching to a count-only summary.
const INLINE_LIMIT = 200;

function ValuesBox({
  values,
  marker,
  color,
}: {
  values: string[];
  marker: string;
  color: "danger" | "success";
}) {
  const textColor = color === "danger" ? "var(--red-11)" : "var(--green-11)";
  return (
    <Flex align="start" mb="1" style={{ color: textColor }}>
      <Box
        mr="2"
        mt="1"
        style={{
          width: 16,
          flexShrink: 0,
          textAlign: "center",
          fontWeight: 600,
          lineHeight: "1.6",
        }}
      >
        {marker}
      </Box>
      <Box
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
          <Text fontStyle="italic" color="text-low">
            None
          </Text>
        )}
      </Box>
    </Flex>
  );
}

// Uses ChangeField for single-line values (booleans, numbers, short strings)
// and an inline ReactDiffViewer for multi-line / JSON values.
function ValueChangedField({
  label,
  pre,
  post,
}: {
  label?: string;
  pre: string | null | undefined;
  post: string | null | undefined;
}) {
  if (isEqual(pre, post)) return null;
  // Treat null, undefined, and empty string as unset
  const displayVal = (v: string | null | undefined): ReactNode =>
    v == null || v === "" ? <em>unset</em> : v;
  const isSimple = (v: string | null | undefined): boolean =>
    v == null || (!v.includes("\n") && v.length <= 80);
  if (isSimple(pre) && isSimple(post)) {
    if (label) {
      return (
        <ChangeField
          label={label}
          changed
          oldNode={displayVal(pre)}
          newNode={displayVal(post)}
        />
      );
    }
    return (
      <Flex align="start" mb="2">
        <Flex align="start" style={{ color: "var(--red-11)" }}>
          <Box mr="2" style={{ width: 16, textAlign: "center" }}>
            Δ
          </Box>
          <Box>{displayVal(pre)}</Box>
        </Flex>
        <Flex
          align="start"
          ml="4"
          style={{ color: "var(--green-11)", fontWeight: 600 }}
        >
          <Box mx="2" style={{ width: 16, textAlign: "center" }}>
            →
          </Box>
          <Box>{displayVal(post)}</Box>
        </Flex>
      </Flex>
    );
  }
  // Multi-line content — use inline diff viewer.
  return (
    <Box mb="2">
      {label && (
        <Box mb="1">
          <Text weight="semibold">{label}</Text>
        </Box>
      )}
      <Box
        className="diff-wrapper diff-wrapper-compact"
        style={{ maxHeight: 250, overflowY: "auto" }}
      >
        <ReactDiffViewer
          oldValue={pre ?? ""}
          newValue={post ?? ""}
          compareMethod={DiffMethod.LINES}
          styles={COMPACT_DIFF_STYLES}
        />
      </Box>
    </Box>
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
      new Set([
        "condition",
        "type",
        "groupName",
        "owner",
        "description",
        "archived",
        "attributeKey",
        "values",
        "projects",
      ]),
    ),
  );

  return <Box mt="1">{rows}</Box>;
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
      // For small deltas, show individual changes as badges
      const added = postVals.filter((v) => !preVals.includes(v));
      const removed = preVals.filter((v) => !postVals.includes(v));
      const deltaCount = added.length + removed.length;

      if (deltaCount > 0 && deltaCount <= 20) {
        rows.push(
          <Box key="values-badges" mb="2">
            <Box mb="1">
              <Text size="medium" weight="medium" color="text-mid">
                Values
              </Text>
            </Box>
            <Flex wrap="wrap" gap="1">
              {removed.slice(0, 10).map((v) => (
                <Badge
                  key={`removed-${v}`}
                  label={`− ${v.length > 30 ? v.slice(0, 30) + "…" : v}`}
                  color="red"
                  variant="soft"
                />
              ))}
              {removed.length > 10 && (
                <Badge
                  label={`− ${removed.length - 10} more`}
                  color="red"
                  variant="soft"
                />
              )}
              {added.slice(0, 10).map((v) => (
                <Badge
                  key={`added-${v}`}
                  label={`+ ${v.length > 30 ? v.slice(0, 30) + "…" : v}`}
                  color="green"
                  variant="soft"
                />
              ))}
              {added.length > 10 && (
                <Badge
                  label={`+ ${added.length - 10} more`}
                  color="green"
                  variant="soft"
                />
              )}
            </Flex>
          </Box>,
        );
      } else {
        // Large delta or complete replacement - show side-by-side boxes
        rows.push(
          <Box key="values" mb="2">
            <Box mb="1">
              <Text size="medium" weight="medium" color="text-mid">
                Values
              </Text>
            </Box>
            <ValuesBox values={preVals} marker="Δ" color="danger" />
            <ValuesBox values={postVals} marker="→" color="success" />
          </Box>,
        );
      }
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
      new Set([
        "attributeKey",
        "values",
        "groupName",
        "owner",
        "description",
        "archived",
        "condition",
        "type",
        "projects",
      ]),
    ),
  );

  return rows.length ? <Box mt="1">{rows}</Box> : null;
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

  if (!isEqual(pre?.owner, post.owner) && post.owner !== undefined) {
    rows.push(
      <ChangeField
        key="owner"
        label="Owner"
        changed
        oldNode={pre?.owner ? <OwnerName id={pre.owner} /> : <em>unset</em>}
        newNode={post.owner ? <OwnerName id={post.owner} /> : <em>unset</em>}
      />,
    );
  }

  if (
    !isEqual(pre?.description, post.description) &&
    post.description !== undefined &&
    (pre?.description || "") !== (post.description || "")
  ) {
    rows.push(
      <ValueChangedField
        key="description"
        label="Description"
        pre={pre?.description || null}
        post={post.description || null}
      />,
    );
  }

  // Archive/unarchive shows up here so a revision whose only change is
  // archive state has a non-empty diff (otherwise the Review/Publish modal
  // reports "No changes to submit" and Discard via the header is the only
  // exit, which is how the archive-with-approval flow used to break).
  const preArchived = !!pre?.archived;
  const postArchived = !!post.archived;
  if (
    post.archived !== undefined &&
    !isEqual(pre?.archived, post.archived) &&
    preArchived !== postArchived
  ) {
    rows.push(
      <ChangeField
        key="archived"
        label="Status"
        changed
        oldNode={preArchived ? "Archived" : "Active"}
        newNode={postArchived ? "Archived" : "Active"}
      />,
    );
  }

  // Project changes (merged into settings)
  if (!isEqual(pre?.projects, post.projects)) {
    const preProjects = pre?.projects ?? [];
    const postProjects = post.projects ?? [];
    if (preProjects.length || postProjects.length) {
      const added = postProjects.filter((id) => !preProjects.includes(id));
      const removed = preProjects.filter((id) => !postProjects.includes(id));
      if (added.length || removed.length) {
        rows.push(
          <ChangeField
            key="projects"
            label="Project"
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
                <em>unset</em>
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
                <em>unset</em>
              )
            }
          />,
        );
      }
    }
  }

  rows.push(
    ...renderFallback(
      pre as Record<string, unknown>,
      post as Record<string, unknown>,
      new Set([
        "groupName",
        "owner",
        "description",
        "archived",
        "condition",
        "type",
        "attributeKey",
        "values",
        "projects",
      ]),
    ),
  );

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

// "Projects" — projects array with resolved names.
// Shows added/removed as badges for better visual clarity.
export function renderSavedGroupProjects(
  pre: Pre,
  post: Post,
): ReactNode | null {
  if (isEqual(pre?.projects, post.projects)) return null;
  const preProjects = pre?.projects ?? [];
  const postProjects = post.projects ?? [];
  if (!preProjects.length && !postProjects.length) return null;

  const added = postProjects.filter((id) => !preProjects.includes(id));
  const removed = preProjects.filter((id) => !postProjects.includes(id));

  const rows: ReactNode[] = [];

  // If there are additions/removals, show them as badges
  if (added.length || removed.length) {
    rows.push(
      <Box key="projects-badges" mb="2">
        <Box mb="1">
          <Text size="medium" weight="medium" color="text-mid">
            Projects
          </Text>
        </Box>
        <Flex wrap="wrap" gap="1">
          {removed.map((id) => (
            <Badge
              key={id}
              label={
                <>
                  − <ProjectName id={id} />
                </>
              }
              color="red"
              variant="soft"
            />
          ))}
          {added.map((id) => (
            <Badge
              key={id}
              label={
                <>
                  + <ProjectName id={id} />
                </>
              }
              color="green"
              variant="soft"
            />
          ))}
        </Flex>
      </Box>,
    );
  } else {
    // No additions/removals, just show the change
    rows.push(
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
    );
  }

  rows.push(
    ...renderFallback(
      pre as Record<string, unknown>,
      post as Record<string, unknown>,
      new Set([
        "projects",
        "groupName",
        "owner",
        "description",
        "archived",
        "condition",
        "type",
        "attributeKey",
        "values",
      ]),
    ),
  );

  return rows.length ? <Box mt="1">{rows}</Box> : null;
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
  if (post.archived !== undefined && !!pre?.archived !== !!post.archived) {
    badges.push(
      post.archived
        ? { label: "Archive", action: "archive" }
        : { label: "Unarchive", action: "unarchive" },
    );
  }
  const preProjects = pre?.projects ?? [];
  const postProjects = post.projects ?? [];
  const addedProjects = postProjects.filter((id) => !preProjects.includes(id));
  const removedProjects = preProjects.filter(
    (id) => !postProjects.includes(id),
  );
  if (addedProjects.length)
    badges.push({
      label: `+${addedProjects.length} project${addedProjects.length !== 1 ? "s" : ""}`,
      action: "add project",
    });
  if (removedProjects.length)
    badges.push({
      label: `−${removedProjects.length} project${removedProjects.length !== 1 ? "s" : ""}`,
      action: "remove project",
    });
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
