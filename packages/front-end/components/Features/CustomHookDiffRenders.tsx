import { ReactNode } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { Flex } from "@radix-ui/themes";
import { CustomHookInterface } from "shared/validators";
import Text from "@/ui/Text";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";

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

function ChangeRow({
  label,
  from,
  to,
}: {
  label: string;
  from: string;
  to: string;
}) {
  return (
    <Flex align="baseline" gap="2" wrap="wrap">
      <span style={{ minWidth: 130, flexShrink: 0 }}>
        <Text size="small" color="text-mid">
          {label}
        </Text>
      </span>
      <span style={{ textDecoration: "line-through" }}>
        <Text size="small" color="text-low">
          {from}
        </Text>
      </span>
      <Text size="small" color="text-low">
        →
      </Text>
      <Text size="small" weight="medium">
        {to}
      </Text>
    </Flex>
  );
}

export function renderCustomHookSettingsSection(
  pre: Snap,
  post: Partial<CustomHookInterface>,
): ReactNode {
  const rows: { label: string; from: string; to: string }[] = [];
  const add = (label: string, from: string, to: string) => {
    if (from !== to) rows.push({ label, from, to });
  };
  add("Name", pre?.name ?? "—", post.name ?? "—");
  add("Hook type", pre?.hook ?? "—", post.hook ?? "—");
  add("Status", statusStr(pre), statusStr(post));
  add("Scope", scopeStr(pre), scopeStr(post));
  add(
    "Incremental only",
    onOff(pre?.incrementalChangesOnly),
    onOff(post.incrementalChangesOnly),
  );

  if (!rows.length) return null;
  return (
    <Flex direction="column" gap="1">
      {rows.map((r) => (
        <ChangeRow key={r.label} {...r} />
      ))}
    </Flex>
  );
}

export function getCustomHookSettingsBadges(
  pre: Snap,
  post: Partial<CustomHookInterface>,
): DiffBadge[] {
  const badges: DiffBadge[] = [];
  if ((pre?.name ?? "") !== (post.name ?? "")) {
    badges.push({ label: "Renamed", action: "update" });
  }
  if ((pre?.hook ?? "") !== (post.hook ?? "")) {
    badges.push({ label: `Type → ${post.hook}`, action: "update" });
  }
  if (statusStr(pre) !== statusStr(post)) {
    badges.push({ label: statusStr(post), action: "update" });
  }
  if (scopeStr(pre) !== scopeStr(post)) {
    badges.push({ label: "Scope changed", action: "update" });
  }
  if (!!pre?.incrementalChangesOnly !== !!post.incrementalChangesOnly) {
    badges.push({
      label: post.incrementalChangesOnly ? "Incremental on" : "Incremental off",
      action: "update",
    });
  }
  return badges;
}

export function renderCustomHookCodeSection(
  pre: Snap,
  post: Partial<CustomHookInterface>,
): ReactNode {
  const preCode = pre?.code ?? "";
  const postCode = post.code ?? "";
  if (preCode === postCode) return null;
  return (
    <div className="diff-wrapper">
      <ReactDiffViewer
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
  return (pre?.code ?? "") !== (post.code ?? "")
    ? [{ label: "Code edited", action: "update" }]
    : [];
}
