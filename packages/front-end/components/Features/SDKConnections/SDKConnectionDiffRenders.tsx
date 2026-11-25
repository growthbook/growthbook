import { ReactNode } from "react";
import isEqual from "lodash/isEqual";
import { Box } from "@radix-ui/themes";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
  SDKConnectionRevisionSnapshot,
  SDKConnectionSettingsRevisionSnapshot,
  SDKWebhookRevisionSnapshot,
  webhookHeadersObject,
  withoutProxySettings,
} from "shared/validators";
import { isCloud } from "@/services/env";
import Text from "@/ui/Text";
import { ChangeField } from "@/components/AuditHistoryExplorer/DiffRenderUtils";
import {
  SAVED_GROUP_FORMAT_LABELS,
  SETTING_TITLES,
  SettingText,
} from "@/components/Features/SDKConnections/sdkConnectionSettingLabels";
import { PAYLOAD_FORMAT_LABELS } from "@/components/Features/SDKConnections/SdkWebhooks";
import { TRACES_TITLE } from "@/components/Features/SDKConnections/SDKConnectionAdvancedSettings";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";
import { RevisionDiffConfig } from "@/components/Revision/useRevisionDiff";
import { snapshotWithAbsentSettings } from "@/components/Features/SDKConnections/sdkConnectionRules";
import { draftLandedState } from "@/components/Revision/revisionUtils";

type Pre = Partial<SDKConnectionRevisionSnapshot> | null;
type Post = Partial<SDKConnectionRevisionSnapshot>;

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

// On/Off, as the settings cards read.
function boolDisplay(v: boolean | undefined | null): ReactNode {
  if ((v ?? null) === null) return <em>—</em>;
  return v ? <Trans>On</Trans> : <Trans>Off</Trans>;
}

type BoolField = {
  key: keyof SDKConnectionSettingsRevisionSnapshot;
  label: MessageDescriptor;
  // Shown the other way round, as its setting is worded.
  inverted?: boolean;
};

// The boolean settings that changed, one row each.
function boolRows(
  fields: BoolField[],
  p0: Partial<SDKConnectionSettingsRevisionSnapshot> | null,
  p1: Partial<SDKConnectionSettingsRevisionSnapshot>,
): ReactNode[] {
  const rows: ReactNode[] = [];
  for (const { key, label, inverted } of fields) {
    const preVal = p0?.[key] as boolean | undefined;
    const postVal = p1[key] as boolean | undefined;
    if (isEqual(preVal, postVal) || postVal === undefined) continue;
    const flip = (v: boolean | undefined) =>
      inverted && v !== undefined ? !v : v;
    rows.push(
      <ChangeField
        key={key}
        label={<SettingText text={label} />}
        changed
        oldNode={boolDisplay(flip(preVal))}
        newNode={boolDisplay(flip(postVal))}
      />,
    );
  }
  return rows;
}

// A boolean setting that changed, as an on or off badge.
function toggleBadge(
  p0: Partial<SDKConnectionSettingsRevisionSnapshot> | null,
  p1: Partial<SDKConnectionSettingsRevisionSnapshot>,
  key: keyof SDKConnectionSettingsRevisionSnapshot,
  on: string,
  off: string,
): DiffBadge[] {
  const v = p1[key];
  if (v === undefined || isEqual(p0?.[key], v)) return [];
  return [
    v ? { label: on, action: "added" } : { label: off, action: "removed" },
  ];
}

function strDisplay(v: string | undefined | null): ReactNode {
  if ((v ?? null) === null || v === "") return <em>—</em>;
  return v;
}

function arrayDisplay(v: string[] | undefined | null): ReactNode {
  if (!v || v.length === 0) return <em>—</em>;
  return v.join(", ");
}

function renderSDKConnectionScope(pre: Pre, post: Post): ReactNode | null {
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
        label={<Trans>Environment</Trans>}
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
        label={<Trans>Projects</Trans>}
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
        label={<Trans>Languages / SDKs</Trans>}
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
        label={<Trans>SDK version</Trans>}
        changed
        oldNode={strDisplay(p0?.sdkVersion)}
        newNode={strDisplay(p1.sdkVersion)}
      />,
    );
  }

  rows.push(
    ...boolRows(
      [
        {
          key: "includeReferencedPrerequisites",
          label: SETTING_TITLES.prerequisites,
        },
      ],
      p0,
      p1,
    ),
  );

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

function getSDKConnectionScopeBadges(pre: Pre, post: Post): DiffBadge[] {
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
    const postProjects = p1.projects;
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

  badges.push(
    ...toggleBadge(
      p0,
      p1,
      "includeReferencedPrerequisites",
      "Prerequisite flags included",
      "Prerequisite flags excluded",
    ),
  );

  return badges;
}

function renderSDKConnectionSecurity(pre: Pre, post: Post): ReactNode | null {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return null;
  const rows = boolRows(
    [
      { key: "encryptPayload", label: SETTING_TITLES.encryptPayload },
      {
        key: "hashSecureAttributes",
        label: SETTING_TITLES.hashSecureAttributes,
      },
      { key: "remoteEvalEnabled", label: msg`Remote evaluation` },
    ],
    p0,
    p1,
  );

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

function getSDKConnectionSecurityBadges(pre: Pre, post: Post): DiffBadge[] {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return [];
  return [
    ...toggleBadge(
      p0,
      p1,
      "encryptPayload",
      "Encrypt payload enabled",
      "Encrypt payload disabled",
    ),
    ...toggleBadge(
      p0,
      p1,
      "hashSecureAttributes",
      "Hash secure attributes enabled",
      "Hash secure attributes disabled",
    ),
  ];
}

function renderSDKConnectionExperiments(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return null;
  const rows = boolRows(
    [
      { key: "includeVisualExperiments", label: SETTING_TITLES.visualEditor },
      { key: "includeRedirectExperiments", label: SETTING_TITLES.urlRedirect },
      {
        key: "includeExperimentNames",
        label: SETTING_TITLES.hideNames,
        inverted: true,
      },
    ],
    p0,
    p1,
  );
  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

function renderSDKConnectionObservability(
  pre: Pre,
  post: Post,
): ReactNode | null {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return null;
  const rows = boolRows(
    [
      { key: "includeRuleIds", label: SETTING_TITLES.ruleIds },
      { key: "includeDraftExperimentRefs", label: SETTING_TITLES.draftRules },
      {
        key: "includeDraftExperiments",
        label: SETTING_TITLES.draftExperiments,
      },
      { key: "tracesEnabled", label: TRACES_TITLE },
    ],
    p0,
    p1,
  );
  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

function renderSDKConnectionMetadata(pre: Pre, post: Post): ReactNode | null {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return null;
  const rows = boolRows(
    [
      { key: "includeProjectIdInMetadata", label: SETTING_TITLES.projectIds },
      {
        key: "includeCustomFieldsInMetadata",
        label: SETTING_TITLES.customFields,
      },
      { key: "includeTagsInMetadata", label: SETTING_TITLES.tags },
      {
        key: "includeExperimentScheduleInMetadata",
        label: SETTING_TITLES.scheduleDates,
      },
      // Still diffed for API callers that write the deprecated boolean.
      {
        key: "savedGroupReferencesEnabled",
        label: SETTING_TITLES.savedGroupReferences,
      },
    ],
    p0,
    p1,
  );

  if (
    !isEqual(p0?.savedGroupFormat, p1.savedGroupFormat) &&
    p1.savedGroupFormat !== undefined
  ) {
    rows.push(
      <ChangeField
        key="savedGroupFormat"
        label={<SettingText text={SETTING_TITLES.savedGroupReferences} />}
        changed
        oldNode={
          p0?.savedGroupFormat ? (
            <SettingText
              text={SAVED_GROUP_FORMAT_LABELS[p0.savedGroupFormat]}
            />
          ) : (
            <em>—</em>
          )
        }
        newNode={
          <SettingText text={SAVED_GROUP_FORMAT_LABELS[p1.savedGroupFormat]} />
        }
      />,
    );
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
        label={<Trans>Allowed custom fields</Trans>}
        changed
        oldNode={arrayDisplay(p0?.allowedCustomFieldsInMetadata)}
        newNode={arrayDisplay(p1.allowedCustomFieldsInMetadata)}
      />,
    );
  }

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

function renderSDKConnectionProxy(pre: Pre, post: Post): ReactNode | null {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return null;
  const rows = boolRows(
    [{ key: "proxyEnabled", label: msg`GrowthBook Proxy` }],
    p0,
    p1,
  );

  if (!isEqual(p0?.proxyHost, p1.proxyHost) && p1.proxyHost !== undefined) {
    rows.push(
      <ChangeField
        key="proxyHost"
        label={<Trans>Proxy host</Trans>}
        changed
        oldNode={strDisplay(p0?.proxyHost)}
        newNode={strDisplay(p1.proxyHost)}
      />,
    );
  }

  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

function getSDKConnectionProxyBadges(pre: Pre, post: Post): DiffBadge[] {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return [];
  const badges: DiffBadge[] = [];

  badges.push(
    ...toggleBadge(p0, p1, "proxyEnabled", "Proxy enabled", "Proxy disabled"),
  );

  if (p1.proxyHost !== undefined && !isEqual(p0?.proxyHost, p1.proxyHost)) {
    badges.push({ label: "Edit proxy host", action: "edit proxy host" });
  }

  return badges;
}

function renderSDKConnectionName(pre: Pre, post: Post): ReactNode | null {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return null;
  const rows: ReactNode[] = [];
  if (!isEqual(p0?.name, p1.name) && p1.name !== undefined) {
    rows.push(
      <ChangeField
        key="name"
        label={<Trans>Name</Trans>}
        changed
        oldNode={strDisplay(p0?.name)}
        newNode={strDisplay(p1.name)}
      />,
    );
  }
  // Picked in the code snippet modal; without a row its revisions read as
  // empty and a draft behind it never shows as behind.
  if ((p0?.eventTracker ?? "") !== (p1.eventTracker ?? "")) {
    rows.push(
      <ChangeField
        key="eventTracker"
        label={<Trans>Event tracker</Trans>}
        changed
        oldNode={strDisplay(p0?.eventTracker)}
        newNode={strDisplay(p1.eventTracker)}
      />,
    );
  }
  return rows.length ? <Box mt="1">{rows}</Box> : null;
}

function getSDKConnectionNameBadges(pre: Pre, post: Post): DiffBadge[] {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return [];
  if (!isEqual(p0?.name, p1.name) && p1.name !== undefined) {
    return [{ label: "Rename", action: "edit name" }];
  }
  return [];
}

function renderSDKConnectionArchived(pre: Pre, post: Post): ReactNode | null {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return null;
  const preArchived = !!p0?.archived;
  const postArchived = !!p1.archived;
  if (p1.archived === undefined || preArchived === postArchived) return null;

  return (
    <Box mt="1">
      <ChangeField
        label={<Trans>Status</Trans>}
        changed
        oldNode={
          <Text color={preArchived ? "text-low" : "text-mid"}>
            {preArchived ? <Trans>Archived</Trans> : <Trans>Active</Trans>}
          </Text>
        }
        newNode={
          <Text color={postArchived ? "text-low" : "text-mid"}>
            {postArchived ? <Trans>Archived</Trans> : <Trans>Active</Trans>}
          </Text>
        }
      />
    </Box>
  );
}

function getSDKConnectionArchivedBadges(pre: Pre, post: Post): DiffBadge[] {
  const p0 = preConn(pre);
  const p1 = postConn(post);
  if (!p1) return [];
  const preArchived = !!p0?.archived;
  const postArchived = !!p1.archived;
  if (p1.archived === undefined || preArchived === postArchived) return [];
  return postArchived
    ? [{ label: "Archive", action: "archive" }]
    : [{ label: "Unarchive", action: "unarchive" }];
}

function timeoutDisplay(v: number | null | undefined): ReactNode {
  return (v ?? null) === null ? (
    <em>
      <Trans>Default</Trans>
    </em>
  ) : (
    `${v}s`
  );
}

function webhookLabel(wh: SDKWebhookRevisionSnapshot): string {
  return wh.name || wh.endpoint || wh.id;
}

// Headers can carry secrets, so their change is shown without the values.
const WEBHOOK_DIFF_FIELDS: {
  key: keyof SDKWebhookRevisionSnapshot;
  // The row's label, after the webhook's name.
  label: (webhook: string) => MessageDescriptor;
  display: (value: unknown) => ReactNode;
}[] = [
  {
    key: "name",
    label: (webhook) => msg`${webhook} name`,
    display: (v) => strDisplay(v as string),
  },
  {
    key: "endpoint",
    label: (webhook) => msg`${webhook} endpoint`,
    display: (v) => strDisplay(v as string),
  },
  {
    key: "httpMethod",
    label: (webhook) => msg`${webhook} method`,
    display: (v) => strDisplay(v as string),
  },
  {
    key: "payloadFormat",
    label: (webhook) => msg`${webhook} payload format`,
    display: (v) => {
      const formatLabel = PAYLOAD_FORMAT_LABELS[v as string];
      return formatLabel ? (
        <SettingText text={formatLabel} />
      ) : (
        strDisplay(v as string)
      );
    },
  },
  {
    key: "payloadKey",
    label: (webhook) => msg`${webhook} payload key`,
    display: (v) => strDisplay(v as string),
  },
  {
    key: "timeoutSeconds",
    label: (webhook) => msg`${webhook} timeout`,
    display: (v) => timeoutDisplay(v as number | undefined),
  },
  {
    key: "headers",
    label: (webhook) => msg`${webhook} headers`,
    display: (v) => {
      const names = headerNames(v);
      return names.length ? (
        names.join(", ")
      ) : (
        <em>
          <Trans>none</Trans>
        </em>
      );
    },
  },
];

const headerNames = (headers: unknown): string[] =>
  Object.keys(
    webhookHeadersObject(typeof headers === "string" ? headers : undefined),
  );

function renderSDKConnectionWebhooks(pre: Pre, post: Post): ReactNode | null {
  const preWebhooks = pre?.sdkWebhooks ?? [];
  const postWebhooks = post.sdkWebhooks;
  if (!postWebhooks) return null;

  const preById = new Map(preWebhooks.map((w) => [w.id, w]));
  const postById = new Map(postWebhooks.map((w) => [w.id, w]));

  const rows: ReactNode[] = [];

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

  for (const wh of postWebhooks) {
    const old = preById.get(wh.id);
    if (!old || isEqual(old, wh)) continue;
    for (const { key, label, display } of WEBHOOK_DIFF_FIELDS) {
      if (isEqual(old[key] ?? null, wh[key] ?? null)) continue;
      // Same header names with new values: say so, without the values.
      const valuesOnly =
        key === "headers" &&
        headerNames(old.headers).length > 0 &&
        isEqual(headerNames(old.headers), headerNames(wh.headers));
      rows.push(
        <ChangeField
          key={`${key}-${wh.id}`}
          label={<SettingText text={label(webhookLabel(wh))} />}
          changed
          oldNode={display(old[key])}
          newNode={
            valuesOnly ? (
              <em>
                <Trans>values changed</Trans>
              </em>
            ) : (
              display(wh[key])
            )
          }
        />,
      );
    }
  }

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

function getSDKConnectionWebhookBadges(pre: Pre, post: Post): DiffBadge[] {
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

// Settings sections share the `sdkConnection` key; each renders null when its
// own fields are unchanged. Section labels also key the diff, so they stay
// plain strings, as the settings cards title them.
export const REVISION_SDK_CONNECTION_DIFF_CONFIG: RevisionDiffConfig<SDKConnectionRevisionSnapshot> =
  {
    // Rows skip a setting the newer side lacks, so fill both sides first.
    normalizeSnapshot: snapshotWithAbsentSettings,
    behindLiveView: (snapshot) =>
      isCloud() ? snapshot : withoutProxySettings(snapshot),
    proposedStateFor: draftLandedState,
    sections: [
      {
        label: "Connection",
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
        label: "Experiments",
        keys: ["sdkConnection"],
        render: renderSDKConnectionExperiments,
      },
      {
        label: "Payload Metadata",
        keys: ["sdkConnection"],
        render: renderSDKConnectionMetadata,
      },
      {
        label: "Observability and QA",
        keys: ["sdkConnection"],
        render: renderSDKConnectionObservability,
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
