import { ReactNode } from "react";
import isEqual from "lodash/isEqual";
import { Box } from "@radix-ui/themes";
import {
  SDKConnectionRevisionSnapshot,
  SDKConnectionSettingsRevisionSnapshot,
  SDKWebhookRevisionSnapshot,
} from "shared/validators";
import Text from "@/ui/Text";
import { ChangeField } from "@/components/AuditHistoryExplorer/DiffRenderUtils";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";
import { RevisionDiffConfig } from "@/components/Revision/useRevisionDiff";

type Pre = Partial<SDKConnectionRevisionSnapshot> | null;
type Post = Partial<SDKConnectionRevisionSnapshot>;

// Settings shortcuts — most render functions only care about the nested
// sdkConnection settings object, not the composite snapshot root.
function preConn(
  pre: Pre,
): Partial<SDKConnectionSettingsRevisionSnapshot> | null {
  return pre?.sdkConnection ?? null;
}
function postConn(
  post: Post,
): Partial<SDKConnectionSettingsRevisionSnapshot> | null {
  return post.sdkConnection ?? null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function boolDisplay(v: boolean | undefined | null): ReactNode {
  if (v == null) return <em>—</em>;
  return v ? "Yes" : "No";
}

function strDisplay(v: string | undefined | null): ReactNode {
  if (v == null || v === "") return <em>—</em>;
  return v;
}

function arrayDisplay(v: string[] | undefined | null): ReactNode {
  if (!v || v.length === 0) return <em>—</em>;
  return v.join(", ");
}

// ─── Section: Scope ───────────────────────────────────────────────────────────

export function renderSDKConnectionScope(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return null;
  const rows: ReactNode[] = [];

  if (
    !isEqual(p0?.environment, p1.environment) &&
    p1.environment !== undefined
  ) {
    rows.push(
      <ChangeField
        key="environment"
        label="Environment"
        changed
        oldNode={strDisplay(p0?.environment)}
        newNode={strDisplay(p1.environment)}
      />,
    );
  }

  if (!isEqual(p0?.projects, p1.projects) && p1.projects !== undefined) {
    rows.push(
      <ChangeField
        key="projects"
        label="Projects"
        changed
        oldNode={arrayDisplay(p0?.projects)}
        newNode={arrayDisplay(p1.projects)}
      />,
    );
  }

  if (!isEqual(p0?.languages, p1.languages) && p1.languages !== undefined) {
    rows.push(
      <ChangeField
        key="languages"
        label="Languages / SDKs"
        changed
        oldNode={arrayDisplay(p0?.languages)}
        newNode={arrayDisplay(p1.languages)}
      />,
    );
  }

  if (!isEqual(p0?.sdkVersion, p1.sdkVersion) && p1.sdkVersion !== undefined) {
    rows.push(
      <ChangeField
        key="sdkVersion"
        label="SDK version"
        changed
        oldNode={strDisplay(p0?.sdkVersion)}
        newNode={strDisplay(p1.sdkVersion)}
      />,
    );
  }

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

export function getSDKConnectionScopeBadges(pre: Pre, post: Post): DiffBadge[] {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return [];
  const badges: DiffBadge[] = [];

  if (
    !isEqual(p0?.environment, p1.environment) &&
    p1.environment !== undefined
  ) {
    badges.push({ label: "Edit environment", action: "edit environment" });
  }

  if (!isEqual(p0?.projects, p1.projects) && p1.projects !== undefined) {
    const preProjects = p0?.projects ?? [];
    const postProjects = p1.projects ?? [];
    const added = postProjects.filter((p) => !preProjects.includes(p));
    const removed = preProjects.filter((p) => !postProjects.includes(p));
    if (added.length)
      badges.push({
        label: `+${added.length} project${added.length !== 1 ? "s" : ""}`,
        action: "add project",
      });
    if (removed.length)
      badges.push({
        label: `-${removed.length} project${removed.length !== 1 ? "s" : ""}`,
        action: "remove project",
      });
    if (!added.length && !removed.length)
      badges.push({ label: "Edit projects", action: "edit projects" });
  }

  if (!isEqual(p0?.languages, p1.languages) && p1.languages !== undefined) {
    badges.push({ label: "Edit languages", action: "edit languages" });
  }

  if (!isEqual(p0?.sdkVersion, p1.sdkVersion) && p1.sdkVersion !== undefined) {
    badges.push({ label: "Edit SDK version", action: "edit SDK version" });
  }

  return badges;
}

// ─── Section: Payload Security ────────────────────────────────────────────────

export function renderSDKConnectionSecurity(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return null;
  const rows: ReactNode[] = [];

  if (
    !isEqual(p0?.encryptPayload, p1.encryptPayload) &&
    p1.encryptPayload !== undefined
  ) {
    rows.push(
      <ChangeField
        key="encryptPayload"
        label="Encrypt payload"
        changed
        oldNode={boolDisplay(p0?.encryptPayload)}
        newNode={boolDisplay(p1.encryptPayload)}
      />,
    );
  }

  if (
    !isEqual(p0?.hashSecureAttributes, p1.hashSecureAttributes) &&
    p1.hashSecureAttributes !== undefined
  ) {
    rows.push(
      <ChangeField
        key="hashSecureAttributes"
        label="Hash secure attributes"
        changed
        oldNode={boolDisplay(p0?.hashSecureAttributes)}
        newNode={boolDisplay(p1.hashSecureAttributes)}
      />,
    );
  }

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

export function getSDKConnectionSecurityBadges(
  pre: Pre,
  post: Post,
): DiffBadge[] {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return [];
  const badges: DiffBadge[] = [];

  if (
    p1.encryptPayload !== undefined &&
    !isEqual(p0?.encryptPayload, p1.encryptPayload)
  ) {
    badges.push(
      p1.encryptPayload
        ? { label: "Encrypt payload enabled", action: "added" }
        : { label: "Encrypt payload disabled", action: "removed" },
    );
  }

  if (
    p1.hashSecureAttributes !== undefined &&
    !isEqual(p0?.hashSecureAttributes, p1.hashSecureAttributes)
  ) {
    badges.push(
      p1.hashSecureAttributes
        ? { label: "Hash secure attributes enabled", action: "added" }
        : { label: "Hash secure attributes disabled", action: "removed" },
    );
  }

  return badges;
}

// ─── Section: Experiment Inclusion ───────────────────────────────────────────

export function renderSDKConnectionExperiments(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return null;

  const fields: Array<{
    key: keyof SDKConnectionSettingsRevisionSnapshot;
    label: string;
  }> = [
    { key: "includeVisualExperiments", label: "Visual Editor experiments" },
    { key: "includeDraftExperiments", label: "Draft experiments" },
    { key: "includeDraftExperimentRefs", label: "Draft experiment rules" },
    { key: "includeExperimentNames", label: "Experiment names" },
    { key: "includeRedirectExperiments", label: "Redirect experiments" },
    { key: "includeRuleIds", label: "Rule IDs" },
  ];

  const rows: ReactNode[] = [];

  for (const { key, label } of fields) {
    const preVal = p0?.[key] as boolean | undefined;
    const postVal = p1[key] as boolean | undefined;
    if (!isEqual(preVal, postVal) && postVal !== undefined) {
      rows.push(
        <ChangeField
          key={key}
          label={label}
          changed
          oldNode={boolDisplay(preVal)}
          newNode={boolDisplay(postVal)}
        />,
      );
    }
  }

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

// ─── Section: Payload Metadata ────────────────────────────────────────────────

export function renderSDKConnectionMetadata(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return null;
  const rows: ReactNode[] = [];

  const boolFields: Array<{
    key: keyof SDKConnectionSettingsRevisionSnapshot;
    label: string;
  }> = [
    { key: "includeProjectIdInMetadata", label: "Include project ID" },
    { key: "includeCustomFieldsInMetadata", label: "Include custom fields" },
    { key: "includeTagsInMetadata", label: "Include tags" },
    {
      key: "includeExperimentScheduleInMetadata",
      label: "Include experiment schedule dates",
    },
    { key: "savedGroupReferencesEnabled", label: "Saved group references" },
    { key: "remoteEvalEnabled", label: "Remote evaluation" },
  ];

  for (const { key, label } of boolFields) {
    const preVal = p0?.[key] as boolean | undefined;
    const postVal = p1[key] as boolean | undefined;
    if (!isEqual(preVal, postVal) && postVal !== undefined) {
      rows.push(
        <ChangeField
          key={key}
          label={label}
          changed
          oldNode={boolDisplay(preVal)}
          newNode={boolDisplay(postVal)}
        />,
      );
    }
  }

  if (
    !isEqual(
      p0?.allowedCustomFieldsInMetadata,
      p1.allowedCustomFieldsInMetadata,
    ) &&
    p1.allowedCustomFieldsInMetadata !== undefined
  ) {
    rows.push(
      <ChangeField
        key="allowedCustomFieldsInMetadata"
        label="Allowed custom fields"
        changed
        oldNode={arrayDisplay(p0?.allowedCustomFieldsInMetadata)}
        newNode={arrayDisplay(p1.allowedCustomFieldsInMetadata)}
      />,
    );
  }

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

// ─── Section: Proxy ───────────────────────────────────────────────────────────

export function renderSDKConnectionProxy(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return null;
  const rows: ReactNode[] = [];

  if (
    !isEqual(p0?.proxyEnabled, p1.proxyEnabled) &&
    p1.proxyEnabled !== undefined
  ) {
    rows.push(
      <ChangeField
        key="proxyEnabled"
        label="GrowthBook Proxy"
        changed
        oldNode={boolDisplay(p0?.proxyEnabled)}
        newNode={boolDisplay(p1.proxyEnabled)}
      />,
    );
  }

  if (!isEqual(p0?.proxyHost, p1.proxyHost) && p1.proxyHost !== undefined) {
    rows.push(
      <ChangeField
        key="proxyHost"
        label="Proxy host"
        changed
        oldNode={strDisplay(p0?.proxyHost)}
        newNode={strDisplay(p1.proxyHost)}
      />,
    );
  }

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

export function getSDKConnectionProxyBadges(pre: Pre, post: Post): DiffBadge[] {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return [];
  const badges: DiffBadge[] = [];

  if (
    p1.proxyEnabled !== undefined &&
    !isEqual(p0?.proxyEnabled, p1.proxyEnabled)
  ) {
    badges.push(
      p1.proxyEnabled
        ? { label: "Proxy enabled", action: "added" }
        : { label: "Proxy disabled", action: "removed" },
    );
  }

  if (p1.proxyHost !== undefined && !isEqual(p0?.proxyHost, p1.proxyHost)) {
    badges.push({ label: "Edit proxy host", action: "edit proxy host" });
  }

  return badges;
}

// ─── Section: Name ────────────────────────────────────────────────────────────

export function renderSDKConnectionName(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return null;
  if (!isEqual(p0?.name, p1.name) && p1.name !== undefined) {
    return (
      <Box mt="1">
        <ChangeField
          label="Name"
          changed
          oldNode={strDisplay(p0?.name)}
          newNode={strDisplay(p1.name)}
        />
      </Box>
    );
  }
  return null;
}

export function getSDKConnectionNameBadges(pre: Pre, post: Post): DiffBadge[] {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return [];
  if (!isEqual(p0?.name, p1.name) && p1.name !== undefined) {
    return [{ label: "Rename", action: "edit name" }];
  }
  return [];
}

// ─── Section: Archived ────────────────────────────────────────────────────────

export function renderSDKConnectionArchived(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return null;
  const preArchived = !!p0?.archived;
  const postArchived = !!p1.archived;
  if (p1.archived === undefined || isEqual(preArchived, postArchived))
    return null;

  return (
    <Box mt="1">
      <ChangeField
        label="Status"
        changed
        oldNode={
          <Text color={preArchived ? "text-low" : "text-mid"}>
            {preArchived ? "Archived" : "Active"}
          </Text>
        }
        newNode={
          <Text color={postArchived ? "text-low" : "text-mid"}>
            {postArchived ? "Archived" : "Active"}
          </Text>
        }
      />
    </Box>
  );
}

export function getSDKConnectionArchivedBadges(
  pre: Pre,
  post: Post,
): DiffBadge[] {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return [];
  const preArchived = !!p0?.archived;
  const postArchived = !!p1.archived;
  if (p1.archived === undefined || isEqual(preArchived, postArchived))
    return [];
  return postArchived
    ? [{ label: "Archive", action: "archive" }]
    : [{ label: "Unarchive", action: "unarchive" }];
}

// ─── Section: Webhooks ────────────────────────────────────────────────────────

function webhookLabel(wh: SDKWebhookRevisionSnapshot): string {
  return wh.name || wh.endpoint || wh.id;
}

export function renderSDKConnectionWebhooks(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const preWebhooks = pre?.sdkWebhooks ?? [];
  const postWebhooks = post.sdkWebhooks;
  if (!postWebhooks) return null;

  const preById = new Map(preWebhooks.map((w) => [w.id, w]));
  const postById = new Map(postWebhooks.map((w) => [w.id, w]));

  const rows: ReactNode[] = [];

  // Added
  for (const wh of postWebhooks) {
    if (!preById.has(wh.id)) {
      rows.push(
        <ChangeField
          key={`add-${wh.id}`}
          label={webhookLabel(wh)}
          changed
          oldNode={<em>—</em>}
          newNode={strDisplay(wh.endpoint)}
        />,
      );
    }
  }

  // Changed
  for (const wh of postWebhooks) {
    const old = preById.get(wh.id);
    if (old && !isEqual(old, wh)) {
      rows.push(
        <ChangeField
          key={`edit-${wh.id}`}
          label={webhookLabel(wh)}
          changed
          oldNode={strDisplay(old.endpoint)}
          newNode={strDisplay(wh.endpoint)}
        />,
      );
    }
  }

  // Removed
  for (const wh of preWebhooks) {
    if (!postById.has(wh.id)) {
      rows.push(
        <ChangeField
          key={`remove-${wh.id}`}
          label={webhookLabel(wh)}
          changed
          oldNode={strDisplay(wh.endpoint)}
          newNode={<em>—</em>}
        />,
      );
    }
  }

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

export function getSDKConnectionWebhookBadges(
  pre: Pre,
  post: Post,
): DiffBadge[] {
  const preWebhooks = pre?.sdkWebhooks ?? [];
  const postWebhooks = post.sdkWebhooks ?? [];

  const preById = new Map(preWebhooks.map((w) => [w.id, w]));
  const postById = new Map(postWebhooks.map((w) => [w.id, w]));

  const added = postWebhooks.filter((w) => !preById.has(w.id)).length;
  const removed = preWebhooks.filter((w) => !postById.has(w.id)).length;
  const changed = postWebhooks.filter((w) => {
    const old = preById.get(w.id);
    return old && !isEqual(old, w);
  }).length;

  const badges: DiffBadge[] = [];
  if (added)
    badges.push({
      label: `+${added} webhook${added !== 1 ? "s" : ""}`,
      action: "add webhook",
    });
  if (removed)
    badges.push({
      label: `-${removed} webhook${removed !== 1 ? "s" : ""}`,
      action: "remove webhook",
    });
  if (changed && !added && !removed)
    badges.push({ label: "Edit webhook", action: "edit webhook" });
  return badges;
}

// ─── Diff Config ──────────────────────────────────────────────────────────────

// All connection-settings sections share the `sdkConnection` top-level key so
// the diff engine detects changes. Each render function internally compares its
// own sub-fields and returns null when nothing in that section changed.
export const REVISION_SDK_CONNECTION_DIFF_CONFIG: RevisionDiffConfig<SDKConnectionRevisionSnapshot> =
  {
    sections: [
      {
        label: "Name",
        keys: ["sdkConnection"],
        render: renderSDKConnectionName,
        getBadges: getSDKConnectionNameBadges,
      },
      {
        label: "Scope",
        keys: ["sdkConnection"],
        render: renderSDKConnectionScope,
        getBadges: getSDKConnectionScopeBadges,
      },
      {
        label: "Payload Security",
        keys: ["sdkConnection"],
        render: renderSDKConnectionSecurity,
        getBadges: getSDKConnectionSecurityBadges,
      },
      {
        label: "Experiment Inclusion",
        keys: ["sdkConnection"],
        render: renderSDKConnectionExperiments,
      },
      {
        label: "Payload Metadata",
        keys: ["sdkConnection"],
        render: renderSDKConnectionMetadata,
      },
      {
        label: "Proxy",
        keys: ["sdkConnection"],
        render: renderSDKConnectionProxy,
        getBadges: getSDKConnectionProxyBadges,
      },
      {
        label: "Archived",
        keys: ["sdkConnection"],
        render: renderSDKConnectionArchived,
        getBadges: getSDKConnectionArchivedBadges,
      },
      {
        label: "Webhooks",
        keys: ["sdkWebhooks"],
        render: renderSDKConnectionWebhooks,
        getBadges: getSDKConnectionWebhookBadges,
      },
    ],
  };
