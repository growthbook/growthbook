import { ReactNode } from "react";
import { DiffMethod } from "react-diff-viewer-continued";
import { Flex } from "@radix-ui/themes";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { CustomHookInterface } from "shared/validators";
import LazyDiffViewer from "@/components/AuditHistoryExplorer/LazyDiffViewer";
import Text from "@/ui/Text";
import Code from "@/components/SyntaxHighlighting/Code";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";

// null `pre` = the hook's creation; render the initial values, not a diff.
type Snap = Partial<CustomHookInterface> | null;

const onOff = (b?: boolean): string => (b ? "On" : "Off");

function statusStr(h: Snap): string {
  if (!h || h.enabled === undefined) return "—";
  return h.enabled ? "Enabled" : "Disabled";
}

function scopeStr(h: Snap): string {
  if (!h) return "—";
  if (h.entityType && h.entityId) return `${h.entityType} · ${h.entityId}`;
  if (h.projects?.length) return `Projects: ${h.projects.join(", ")}`;
  return "Global";
}

// What the settings rows show; the strings above stay for comparing snapshots.
const onOffNode = (b?: boolean): ReactNode =>
  b ? <Trans>On</Trans> : <Trans>Off</Trans>;

function statusNode(h: Snap): ReactNode {
  if (!h || h.enabled === undefined) return "—";
  return h.enabled ? <Trans>Enabled</Trans> : <Trans>Disabled</Trans>;
}

function scopeNode(h: Snap): ReactNode {
  if (!h) return "—";
  if (h.entityType && h.entityId) return `${h.entityType} · ${h.entityId}`;
  if (h.projects?.length) {
    const projectList = h.projects.join(", ");
    return <Trans>Projects: {projectList}</Trans>;
  }
  return <Trans>Global</Trans>;
}

function ChangeRow({
  label,
  from,
  to,
}: {
  label: ReactNode;
  from?: ReactNode;
  to: ReactNode;
}) {
  return (
    <Flex align="baseline" gap="2" wrap="wrap">
      <span style={{ minWidth: 130, flexShrink: 0 }}>
        <Text size="sm" color="text-mid">
          {label}
        </Text>
      </span>
      {from !== undefined && (
        <>
          <span style={{ textDecoration: "line-through" }}>
            <Text size="sm" color="text-low">
              {from}
            </Text>
          </span>
          <Text size="sm" color="text-low">
            →
          </Text>
        </>
      )}
      <Text size="sm" weight="medium">
        {to}
      </Text>
    </Flex>
  );
}

export function renderCustomHookSettingsSection(
  pre: Snap,
  post: Partial<CustomHookInterface>,
): ReactNode {
  const rows: {
    id: string;
    label: ReactNode;
    from?: ReactNode;
    to: ReactNode;
  }[] = [];
  const add = (
    id: string,
    label: ReactNode,
    [from, fromNode]: [string, ReactNode],
    [to, toNode]: [string, ReactNode],
  ) => {
    if (pre === null) rows.push({ id, label, to: toNode });
    else if (from !== to) rows.push({ id, label, from: fromNode, to: toNode });
  };
  const preName = pre?.name ?? "—";
  const postName = post.name ?? "—";
  const preHook = pre?.hook ?? "—";
  const postHook = post.hook ?? "—";
  add("name", <Trans>Name</Trans>, [preName, preName], [postName, postName]);
  add(
    "hook",
    <Trans>Hook type</Trans>,
    [preHook, preHook],
    [postHook, postHook],
  );
  add(
    "status",
    <Trans>Status</Trans>,
    [statusStr(pre), statusNode(pre)],
    [statusStr(post), statusNode(post)],
  );
  add(
    "scope",
    <Trans>Scope</Trans>,
    [scopeStr(pre), scopeNode(pre)],
    [scopeStr(post), scopeNode(post)],
  );
  add(
    "incremental",
    <Trans>Incremental only</Trans>,
    [
      onOff(pre?.incrementalChangesOnly),
      onOffNode(pre?.incrementalChangesOnly),
    ],
    [
      onOff(post.incrementalChangesOnly),
      onOffNode(post.incrementalChangesOnly),
    ],
  );

  if (!rows.length) return null;
  return (
    <Flex direction="column" gap="1">
      {rows.map(({ id, ...r }) => (
        <ChangeRow key={id} {...r} />
      ))}
    </Flex>
  );
}

export function getCustomHookSettingsBadges(
  pre: Snap,
  post: Partial<CustomHookInterface>,
): DiffBadge[] {
  if (pre === null) return [];
  const badges: DiffBadge[] = [];
  if ((pre.name ?? "") !== (post.name ?? "")) {
    badges.push({
      label: "Renamed",
      displayLabel: msg`Renamed`,
      action: "update",
    });
  }
  if ((pre.hook ?? "") !== (post.hook ?? "")) {
    const hookType = String(post.hook);
    badges.push({
      label: `Type → ${hookType}`,
      displayLabel: msg`Type → ${hookType}`,
      action: "update",
    });
  }
  if (statusStr(pre) !== statusStr(post)) {
    badges.push({
      label: statusStr(post),
      displayLabel:
        post.enabled === undefined
          ? undefined
          : post.enabled
            ? msg`Enabled`
            : msg`Disabled`,
      action: "update",
    });
  }
  if (scopeStr(pre) !== scopeStr(post)) {
    badges.push({
      label: "Scope changed",
      displayLabel: msg`Scope changed`,
      action: "update",
    });
  }
  if (!!pre.incrementalChangesOnly !== !!post.incrementalChangesOnly) {
    badges.push(
      post.incrementalChangesOnly
        ? {
            label: "Incremental on",
            displayLabel: msg`Incremental on`,
            action: "update",
          }
        : {
            label: "Incremental off",
            displayLabel: msg`Incremental off`,
            action: "update",
          },
    );
  }
  return badges;
}

export function renderCustomHookCodeSection(
  pre: Snap,
  post: Partial<CustomHookInterface>,
): ReactNode {
  const postCode = post.code ?? "";
  if (pre === null) {
    return <Code language="javascript" code={postCode} />;
  }
  const preCode = pre.code ?? "";
  if (preCode === postCode) return null;
  return (
    <div className="diff-wrapper">
      <LazyDiffViewer
        oldValue={preCode}
        newValue={postCode}
        splitView
        compareMethod={DiffMethod.LINES}
        styles={COMPACT_DIFF_STYLES}
      />
    </div>
  );
}

export function getCustomHookCodeBadges(
  pre: Snap,
  post: Partial<CustomHookInterface>,
): DiffBadge[] {
  if (pre === null) return [];
  return (pre.code ?? "") !== (post.code ?? "")
    ? [
        {
          label: "Code edited",
          displayLabel: msg`Code edited`,
          action: "update",
        },
      ]
    : [];
}
