import { ReactNode } from "react";
import isEqual from "lodash/isEqual";
import { Box } from "@radix-ui/themes";
import { SDKConnectionRevisionSnapshot } from "shared/validators";
import Text from "@/ui/Text";
import { ChangeField } from "@/components/AuditHistoryExplorer/DiffRenderUtils";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";
import { RevisionDiffConfig } from "@/components/Revision/useRevisionDiff";

type Pre = Partial<SDKConnectionRevisionSnapshot> | null;
type Post = Partial<SDKConnectionRevisionSnapshot>;

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
  const rows: ReactNode[] = [];

  if (
    !isEqual(pre?.environment, post.environment) &&
    post.environment !== undefined
  ) {
    rows.push(
      <ChangeField
        key="environment"
        label="Environment"
        changed
        oldNode={strDisplay(pre?.environment)}
        newNode={strDisplay(post.environment)}
      />,
    );
  }

  if (!isEqual(pre?.projects, post.projects) && post.projects !== undefined) {
    rows.push(
      <ChangeField
        key="projects"
        label="Projects"
        changed
        oldNode={arrayDisplay(pre?.projects)}
        newNode={arrayDisplay(post.projects)}
      />,
    );
  }

  if (
    !isEqual(pre?.languages, post.languages) &&
    post.languages !== undefined
  ) {
    rows.push(
      <ChangeField
        key="languages"
        label="Languages / SDKs"
        changed
        oldNode={arrayDisplay(pre?.languages)}
        newNode={arrayDisplay(post.languages)}
      />,
    );
  }

  if (
    !isEqual(pre?.sdkVersion, post.sdkVersion) &&
    post.sdkVersion !== undefined
  ) {
    rows.push(
      <ChangeField
        key="sdkVersion"
        label="SDK version"
        changed
        oldNode={strDisplay(pre?.sdkVersion)}
        newNode={strDisplay(post.sdkVersion)}
      />,
    );
  }

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

export function getSDKConnectionScopeBadges(pre: Pre, post: Post): DiffBadge[] {
  const badges: DiffBadge[] = [];

  if (
    !isEqual(pre?.environment, post.environment) &&
    post.environment !== undefined
  ) {
    badges.push({ label: "Edit environment", action: "edit environment" });
  }

  if (!isEqual(pre?.projects, post.projects) && post.projects !== undefined) {
    const preProjects = pre?.projects ?? [];
    const postProjects = post.projects ?? [];
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

  if (
    !isEqual(pre?.languages, post.languages) &&
    post.languages !== undefined
  ) {
    badges.push({ label: "Edit languages", action: "edit languages" });
  }

  if (
    !isEqual(pre?.sdkVersion, post.sdkVersion) &&
    post.sdkVersion !== undefined
  ) {
    badges.push({ label: "Edit SDK version", action: "edit SDK version" });
  }

  return badges;
}

// ─── Section: Payload Security ────────────────────────────────────────────────

export function renderSDKConnectionSecurity(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const rows: ReactNode[] = [];

  if (
    !isEqual(pre?.encryptPayload, post.encryptPayload) &&
    post.encryptPayload !== undefined
  ) {
    rows.push(
      <ChangeField
        key="encryptPayload"
        label="Encrypt payload"
        changed
        oldNode={boolDisplay(pre?.encryptPayload)}
        newNode={boolDisplay(post.encryptPayload)}
      />,
    );
  }

  if (
    !isEqual(pre?.hashSecureAttributes, post.hashSecureAttributes) &&
    post.hashSecureAttributes !== undefined
  ) {
    rows.push(
      <ChangeField
        key="hashSecureAttributes"
        label="Hash secure attributes"
        changed
        oldNode={boolDisplay(pre?.hashSecureAttributes)}
        newNode={boolDisplay(post.hashSecureAttributes)}
      />,
    );
  }

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

export function getSDKConnectionSecurityBadges(
  pre: Pre,
  post: Post,
): DiffBadge[] {
  const badges: DiffBadge[] = [];

  if (
    post.encryptPayload !== undefined &&
    !isEqual(pre?.encryptPayload, post.encryptPayload)
  ) {
    badges.push(
      post.encryptPayload
        ? { label: "Encrypt payload enabled", action: "added" }
        : { label: "Encrypt payload disabled", action: "removed" },
    );
  }

  if (
    post.hashSecureAttributes !== undefined &&
    !isEqual(pre?.hashSecureAttributes, post.hashSecureAttributes)
  ) {
    badges.push(
      post.hashSecureAttributes
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
  const fields: Array<{
    key: keyof SDKConnectionRevisionSnapshot;
    label: string;
  }> = [
    { key: "includeVisualExperiments", label: "Visual Editor experiments" },
    { key: "includeDraftExperiments", label: "Draft experiments" },
    { key: "includeExperimentNames", label: "Experiment names" },
    { key: "includeRedirectExperiments", label: "Redirect experiments" },
    { key: "includeRuleIds", label: "Rule IDs" },
  ];

  const rows: ReactNode[] = [];

  for (const { key, label } of fields) {
    const preVal = pre?.[key] as boolean | undefined;
    const postVal = post[key] as boolean | undefined;
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
  const rows: ReactNode[] = [];

  const boolFields: Array<{
    key: keyof SDKConnectionRevisionSnapshot;
    label: string;
  }> = [
    { key: "includeProjectIdInMetadata", label: "Include project ID" },
    { key: "includeCustomFieldsInMetadata", label: "Include custom fields" },
    { key: "includeTagsInMetadata", label: "Include tags" },
    { key: "savedGroupReferencesEnabled", label: "Saved group references" },
    { key: "remoteEvalEnabled", label: "Remote evaluation" },
  ];

  for (const { key, label } of boolFields) {
    const preVal = pre?.[key] as boolean | undefined;
    const postVal = post[key] as boolean | undefined;
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
      pre?.allowedCustomFieldsInMetadata,
      post.allowedCustomFieldsInMetadata,
    ) &&
    post.allowedCustomFieldsInMetadata !== undefined
  ) {
    rows.push(
      <ChangeField
        key="allowedCustomFieldsInMetadata"
        label="Allowed custom fields"
        changed
        oldNode={arrayDisplay(pre?.allowedCustomFieldsInMetadata)}
        newNode={arrayDisplay(post.allowedCustomFieldsInMetadata)}
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
  const rows: ReactNode[] = [];

  if (
    !isEqual(pre?.proxyEnabled, post.proxyEnabled) &&
    post.proxyEnabled !== undefined
  ) {
    rows.push(
      <ChangeField
        key="proxyEnabled"
        label="GrowthBook Proxy"
        changed
        oldNode={boolDisplay(pre?.proxyEnabled)}
        newNode={boolDisplay(post.proxyEnabled)}
      />,
    );
  }

  if (
    !isEqual(pre?.proxyHost, post.proxyHost) &&
    post.proxyHost !== undefined
  ) {
    rows.push(
      <ChangeField
        key="proxyHost"
        label="Proxy host"
        changed
        oldNode={strDisplay(pre?.proxyHost)}
        newNode={strDisplay(post.proxyHost)}
      />,
    );
  }

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

export function getSDKConnectionProxyBadges(pre: Pre, post: Post): DiffBadge[] {
  const badges: DiffBadge[] = [];

  if (
    post.proxyEnabled !== undefined &&
    !isEqual(pre?.proxyEnabled, post.proxyEnabled)
  ) {
    badges.push(
      post.proxyEnabled
        ? { label: "Proxy enabled", action: "added" }
        : { label: "Proxy disabled", action: "removed" },
    );
  }

  if (
    post.proxyHost !== undefined &&
    !isEqual(pre?.proxyHost, post.proxyHost)
  ) {
    badges.push({ label: "Edit proxy host", action: "edit proxy host" });
  }

  return badges;
}

// ─── Section: Name ────────────────────────────────────────────────────────────

export function renderSDKConnectionName(
  pre: Pre,
  post: Post,
): ReactNode | null {
  if (!isEqual(pre?.name, post.name) && post.name !== undefined) {
    return (
      <Box mt="1">
        <ChangeField
          label="Name"
          changed
          oldNode={strDisplay(pre?.name)}
          newNode={strDisplay(post.name)}
        />
      </Box>
    );
  }
  return null;
}

export function getSDKConnectionNameBadges(pre: Pre, post: Post): DiffBadge[] {
  if (!isEqual(pre?.name, post.name) && post.name !== undefined) {
    return [{ label: "Rename", action: "edit name" }];
  }
  return [];
}

// ─── Section: Archived ────────────────────────────────────────────────────────

export function renderSDKConnectionArchived(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const preArchived = !!pre?.archived;
  const postArchived = !!post.archived;
  if (post.archived === undefined || isEqual(preArchived, postArchived))
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
  const preArchived = !!pre?.archived;
  const postArchived = !!post.archived;
  if (post.archived === undefined || isEqual(preArchived, postArchived))
    return [];
  return postArchived
    ? [{ label: "Archive", action: "archive" }]
    : [{ label: "Unarchive", action: "unarchive" }];
}

// ─── Diff Config ──────────────────────────────────────────────────────────────

export const REVISION_SDK_CONNECTION_DIFF_CONFIG: RevisionDiffConfig<SDKConnectionRevisionSnapshot> =
  {
    sections: [
      {
        label: "Name",
        keys: ["name"] as (keyof SDKConnectionRevisionSnapshot)[],
        render: renderSDKConnectionName,
        getBadges: getSDKConnectionNameBadges,
      },
      {
        label: "Scope",
        keys: [
          "environment",
          "projects",
          "languages",
          "sdkVersion",
        ] as (keyof SDKConnectionRevisionSnapshot)[],
        render: renderSDKConnectionScope,
        getBadges: getSDKConnectionScopeBadges,
      },
      {
        label: "Payload Security",
        keys: [
          "encryptPayload",
          "hashSecureAttributes",
        ] as (keyof SDKConnectionRevisionSnapshot)[],
        render: renderSDKConnectionSecurity,
        getBadges: getSDKConnectionSecurityBadges,
      },
      {
        label: "Experiment Inclusion",
        keys: [
          "includeVisualExperiments",
          "includeDraftExperiments",
          "includeExperimentNames",
          "includeRedirectExperiments",
          "includeRuleIds",
        ] as (keyof SDKConnectionRevisionSnapshot)[],
        render: renderSDKConnectionExperiments,
      },
      {
        label: "Payload Metadata",
        keys: [
          "includeProjectIdInMetadata",
          "includeCustomFieldsInMetadata",
          "allowedCustomFieldsInMetadata",
          "includeTagsInMetadata",
          "savedGroupReferencesEnabled",
          "remoteEvalEnabled",
        ] as (keyof SDKConnectionRevisionSnapshot)[],
        render: renderSDKConnectionMetadata,
      },
      {
        label: "Proxy",
        keys: [
          "proxyEnabled",
          "proxyHost",
        ] as (keyof SDKConnectionRevisionSnapshot)[],
        render: renderSDKConnectionProxy,
        getBadges: getSDKConnectionProxyBadges,
      },
      {
        label: "Archived",
        keys: ["archived"] as (keyof SDKConnectionRevisionSnapshot)[],
        render: renderSDKConnectionArchived,
        getBadges: getSDKConnectionArchivedBadges,
      },
    ],
  };
