import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiRadioButton, PiMagnifyingGlass } from "react-icons/pi";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import VariationNumber from "@/ui/VariationNumber";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import Tooltip from "@/components/Tooltip/Tooltip";
import { Popover } from "@/ui/Popover";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { valueToDisplayString } from "@/components/Configs/fieldSchema";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ConfigKeyImplementation } from "@/hooks/useConstantReferences";
import styles from "./ConfigUsageTable.module.scss";

// Shared row formats for config-key usage, rendered both in the per-key hover
// popover and in grouped tables below the config editor.

const RULE_TYPE_LABELS: Record<string, string> = {
  force: "Force",
  rollout: "Rollout",
  experiment: "Experiment",
  "experiment-ref": "Experiment",
  "contextual-bandit-ref": "Bandit",
  "safe-rollout": "Safe rollout",
};

function locationLabel(impl: ConfigKeyImplementation): string {
  if (impl.location === "defaultValue") return "Default";
  if (!impl.ruleType) return "Rule";
  return RULE_TYPE_LABELS[impl.ruleType] ?? impl.ruleType;
}

export const EXPERIMENT_STATUS_COLORS: Record<
  string,
  React.ComponentProps<typeof Badge>["color"]
> = {
  running: "green",
  stopped: "blue",
  draft: "gray",
};

const EXPERIMENT_STATUS_SEVERITY: Record<string, number> = {
  running: 3,
  stopped: 2,
  draft: 1,
};

// The color of the most severe experiment status among the implementations
// (running > stopped > draft).
export function experimentStatusColor(
  impls: ConfigKeyImplementation[],
): string {
  let best = "";
  let bestRank = 0;
  for (const i of impls) {
    const rank = EXPERIMENT_STATUS_SEVERITY[i.experimentStatus ?? ""] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = i.experimentStatus ?? "";
    }
  }
  return EXPERIMENT_STATUS_COLORS[best] ?? "gray";
}

// Distinct flag-revision dots for the implementations: one green if any linkage
// is live, one amber if any is a draft (collapsed by type, like the feature list).
export function stateDots(impls: ConfigKeyImplementation[]): string[] {
  const dots: string[] = [];
  if (impls.some((i) => i.state === "live")) dots.push("var(--green-9)");
  if (impls.some((i) => i.state === "draft")) dots.push("var(--amber-9)");
  return dots;
}

// A deduped row plus the per-variation arms it collapsed (one entry for a plain
// rule/default), so the override-value drilldown can show each arm's patch.
export type DedupedImplementation = ConfigKeyImplementation & {
  variations: ConfigKeyImplementation[];
};

// Collapse a rule's variation arms (each arm is its own implementation) into one
// row per reference, unioning the keys each arm overrides — otherwise a rule
// whose control arm overrides nothing would show no overrides. The collapsed
// arms are retained on `variations` (in discovery order) for the value drilldown.
export function dedupeImplementations(
  impls: ConfigKeyImplementation[],
): DedupedImplementation[] {
  const bySignature = new Map<string, DedupedImplementation>();
  for (const i of impls) {
    const k = [
      i.featureId,
      i.location,
      i.ruleId ?? "",
      i.experimentId ?? "",
      // Arms of one rule can back different configs; keep those as separate rows.
      i.configKey,
      i.state,
    ].join("|");
    const existing = bySignature.get(k);
    if (existing) {
      existing.keys = [...new Set([...existing.keys, ...i.keys])];
      existing.variations.push(i);
    } else {
      bySignature.set(k, { ...i, keys: [...i.keys], variations: [i] });
    }
  }
  return [...bySignature.values()];
}

// The raw override value(s) a reference sets, rendered like the config field
// table (ValueDisplay). Experiment/bandit refs stack one section per variation.
// `keys` scopes which fields to show (the row's own keys — already limited to
// the viewed config's fieldset — so a mixin row can't leak unrelated overrides).
function OverrideValues({
  impl,
  keys,
}: {
  impl: DedupedImplementation;
  keys: string[];
}): React.ReactElement {
  const variations = impl.variations;
  const multi = variations.length > 1;
  return (
    <Flex direction="column" gap="4" style={{ minWidth: 300 }}>
      {variations.map((v, i) => {
        const patch = v.patch ?? {};
        const shownKeys = keys.filter((k) => k in patch);
        return (
          <Box key={`${v.variationId ?? ""}|${i}`}>
            {multi && (
              <Box mb="2">
                <VariationNumber number={i} />
              </Box>
            )}
            {shownKeys.length === 0 ? (
              <Text as="div" size="small" color="text-low">
                No override
              </Text>
            ) : (
              // Two-column key/value grid, mirroring the config field table.
              <Box
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(0, 1fr)",
                  columnGap: "var(--space-5)",
                  rowGap: "var(--space-2)",
                  alignItems: "start",
                }}
              >
                {shownKeys.map((k) => (
                  <React.Fragment key={k}>
                    <code style={{ color: "var(--slate-12)" }}>{k}</code>
                    <ValueDisplay
                      value={valueToDisplayString(patch[k], "json")}
                      type="json"
                    />
                  </React.Fragment>
                ))}
              </Box>
            )}
          </Box>
        );
      })}
    </Flex>
  );
}

// Row trigger that opens the override-value drilldown.
function OverridePopoverTrigger({
  impl,
  keys,
}: {
  impl: DedupedImplementation;
  keys: string[];
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    // While the popover is open, force the tooltip closed AND ignore hover so
    // re-entering the trigger can't re-open it on top of the popover.
    <Tooltip
      body="View override values"
      state={open ? false : undefined}
      ignoreMouseEvents={open}
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="left"
        align="start"
        triggerAsChild
        trigger={
          <Button
            variant="ghost"
            color="violet"
            icon={<PiMagnifyingGlass />}
            aria-label="View override values"
          >
            Overrides
          </Button>
        }
        content={
          <Box style={{ maxWidth: "min(92vw, 560px)" }}>
            <OverrideValues impl={impl} keys={keys} />
          </Box>
        }
      />
    </Tooltip>
  );
}

function FlagRevisionBadge({
  impl,
}: {
  impl: ConfigKeyImplementation;
}): React.ReactElement {
  if (impl.state === "draft") {
    return (
      <Badge
        color="amber"
        variant="soft"
        radius="full"
        label={
          (impl.revisionVersion ?? null) !== null
            ? `Draft v${impl.revisionVersion}`
            : "Draft"
        }
      />
    );
  }
  return <Badge color="green" variant="soft" radius="full" label="Live" />;
}

// The backing config relative to the config being viewed — mirrors the main
// config table's "source" column (this config / an ancestor / a descendant).
function ConfigSourceCell({
  impl,
}: {
  impl: ConfigKeyImplementation;
}): React.ReactElement {
  const { getConfigByKey } = useDefinitions();
  const relation = impl.relation ?? "other";

  if (relation === "self") {
    return (
      <Badge
        color="gray"
        variant="soft"
        radius="full"
        label={
          <Flex align="center" gap="1">
            <PiRadioButton /> This config
          </Flex>
        }
      />
    );
  }

  const name = getConfigByKey(impl.configKey)?.name ?? impl.configKey;
  return (
    <Badge
      color="gray"
      variant="soft"
      radius="full"
      title={name}
      label={
        <Link
          href={`/configs/${impl.configKey}`}
          title={name}
          style={{ color: "var(--accent-11)" }}
        >
          {/* hover-underline on the span, not the anchor: text-decoration
              doesn't cross an inline-block, so it must sit on the ellipsis'd
              element to reach the text. Config links stay in-app (no target). */}
          <OverflowText className="hover-underline" maxWidth={110}>
            {name}
          </OverflowText>
        </Link>
      }
    />
  );
}

function FeatureLink({
  impl,
  maxWidth = FEATURE_WIDTH - 30,
}: {
  impl: ConfigKeyImplementation;
  maxWidth?: number | string;
}): React.ReactElement {
  // A draft-only linkage links to that specific feature draft revision.
  const href =
    impl.state === "draft" && (impl.revisionVersion ?? null) !== null
      ? `/features/${impl.featureId}?v=${impl.revisionVersion}`
      : `/features/${impl.featureId}`;
  return (
    <Link href={href} title={impl.featureId} target="_blank" rel="noreferrer">
      <OverflowText className="hover-underline" maxWidth={maxWidth}>
        {impl.featureId}
      </OverflowText>
    </Link>
  );
}

// The linked analysis unit: an experiment (experiment-ref) or a contextual
// bandit (contextual-bandit-ref), each linking to its own detail page. Empty for
// plain rules (force/rollout/etc).
function ExperimentCell({
  impl,
  maxWidth = EXPERIMENT_WIDTH - 30,
}: {
  impl: ConfigKeyImplementation;
  maxWidth?: number | string;
}): React.ReactElement | null {
  const href = impl.experimentId
    ? `/experiment/${impl.experimentId}`
    : impl.contextualBanditId
      ? `/contextual-bandit/${impl.contextualBanditId}`
      : null;
  if (!href)
    return impl.experimentName ? (
      <Text size="small">{impl.experimentName}</Text>
    ) : null;
  const label =
    impl.experimentName ?? impl.experimentId ?? impl.contextualBanditId ?? href;
  return (
    <Link href={href} title={label} target="_blank" rel="noreferrer">
      <OverflowText className="hover-underline" maxWidth={maxWidth}>
        {label}
      </OverflowText>
    </Link>
  );
}

// The linked experiment/bandit's lifecycle status (empty for plain rules).
function StatusCell({
  impl,
}: {
  impl: ConfigKeyImplementation;
}): React.ReactElement | null {
  const status = impl.experimentStatus;
  if (!status) return null;
  return (
    <Badge
      color={EXPERIMENT_STATUS_COLORS[status] ?? "gray"}
      variant="soft"
      radius="full"
      label={status.charAt(0).toUpperCase() + status.slice(1)}
    />
  );
}

function KeyCode({ k }: { k: string }): React.ReactElement {
  return (
    <code title={k} style={{ color: "var(--slate-12)" }}>
      {k}
    </code>
  );
}

// A reference can touch many keys; cap the visible list so a row stays compact.
const MAX_VISIBLE_KEYS = 3;

// The config keys a row overrides — shown only in the flat "by reference" view,
// where a single reference can touch several keys. Ordered to match the field
// list in the config table above; one key per line, with the overflow collapsed
// into a hover "+N more" (matching the environment-select overflow pattern).
function KeyCell({
  keys,
  keyOrder,
}: {
  keys: string[];
  keyOrder?: string[];
}): React.ReactElement {
  if (!keys.length)
    return (
      <Text size="small" color="text-low">
        —
      </Text>
    );
  const ordered = keyOrder
    ? [
        ...keyOrder.filter((k) => keys.includes(k)),
        ...keys.filter((k) => !keyOrder.includes(k)),
      ]
    : keys;
  const visible = ordered.slice(0, MAX_VISIBLE_KEYS);
  const overflow = ordered.slice(MAX_VISIBLE_KEYS);
  return (
    <Flex direction="column" gap="1" align="start">
      {visible.map((k) => (
        <KeyCode key={k} k={k} />
      ))}
      {overflow.length > 0 && (
        <Tooltip
          flipTheme={false}
          body={
            <Flex direction="column" gap="1" align="start">
              {overflow.map((k) => (
                <KeyCode key={k} k={k} />
              ))}
            </Flex>
          }
        >
          <Text as="span" size="small" color="text-low">
            +{overflow.length} more
          </Text>
        </Tooltip>
      )}
    </Flex>
  );
}

const LOCATION_WIDTH = 120;
const STATUS_WIDTH = 90;
const CONFIG_SOURCE_WIDTH = 190;
const FLAG_REVISION_WIDTH = 170;
const KEY_WIDTH = 200;
const FEATURE_WIDTH = 200;
const EXPERIMENT_WIDTH = 160;

const GROUP_BORDER = "1px solid var(--slate-a3)";

// Grid column tracks for the section tables below the editor. Flexible so the
// grid fits the container without a horizontal-scroll wrapper — that wrapper is
// what stops a Radix table's header from sticking to the page.
// Columns: Key | Feature | Revision status | Experiment | Exp status | Location | Config source | (override)
const BY_KEY_COLS =
  "minmax(80px, 130px) minmax(120px, 1.2fr) 100px minmax(110px, 1fr) 90px 100px 150px 32px";
// Columns: Feature | Overrides | Revision status | Experiment | Exp status | Location | Config source | (override)
const BY_REF_COLS =
  "minmax(120px, 1.2fr) minmax(120px, 190px) 100px minmax(110px, 1fr) 90px 100px 150px 32px";

function UsageGridHeader({
  columns,
  labels,
}: {
  columns: string;
  labels: (string | null)[];
}): React.ReactElement {
  return (
    <div
      className={styles.headerRow}
      style={{ gridTemplateColumns: columns }}
      role="row"
    >
      {labels.map((label, i) => (
        <div key={i} role="columnheader">
          {label}
        </div>
      ))}
    </div>
  );
}

export function FeatureUsageTable({
  implementations,
  showKeys = false,
  keyOrder,
}: {
  implementations: ConfigKeyImplementation[];
  showKeys?: boolean;
  keyOrder?: string[];
}): React.ReactElement {
  return (
    <Table
      variant="ghost"
      className={styles.usageTable}
      style={{ width: "max-content", maxWidth: "100%" }}
    >
      <TableHeader>
        <TableRow>
          <TableColumnHeader style={{ width: FEATURE_WIDTH }}>
            Feature
          </TableColumnHeader>
          <TableColumnHeader style={{ width: FLAG_REVISION_WIDTH }}>
            Status
          </TableColumnHeader>
          <TableColumnHeader style={{ width: LOCATION_WIDTH }}>
            Location
          </TableColumnHeader>
          <TableColumnHeader style={{ width: CONFIG_SOURCE_WIDTH }}>
            Config source
          </TableColumnHeader>
          {showKeys && (
            <TableColumnHeader style={{ width: KEY_WIDTH }}>
              Overrides
            </TableColumnHeader>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {implementations.map((impl, i) => (
          <TableRow key={i}>
            <TableCell>
              <FeatureLink impl={impl} />
            </TableCell>
            <TableCell>
              <FlagRevisionBadge impl={impl} />
            </TableCell>
            <TableCell>{locationLabel(impl)}</TableCell>
            <TableCell>
              <ConfigSourceCell impl={impl} />
            </TableCell>
            {showKeys && (
              <TableCell>
                <KeyCell keys={impl.keys} keyOrder={keyOrder} />
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ExperimentUsageTable({
  implementations,
  showKeys = false,
  keyOrder,
}: {
  implementations: ConfigKeyImplementation[];
  showKeys?: boolean;
  keyOrder?: string[];
}): React.ReactElement {
  return (
    <Table
      variant="ghost"
      className={styles.usageTable}
      style={{ width: "max-content", maxWidth: "100%" }}
    >
      <TableHeader>
        <TableRow>
          <TableColumnHeader style={{ width: EXPERIMENT_WIDTH }}>
            Experiment
          </TableColumnHeader>
          <TableColumnHeader style={{ width: STATUS_WIDTH }} />
          <TableColumnHeader style={{ width: FEATURE_WIDTH }}>
            Feature
          </TableColumnHeader>
          <TableColumnHeader style={{ width: FLAG_REVISION_WIDTH }}>
            Status
          </TableColumnHeader>
          <TableColumnHeader style={{ width: CONFIG_SOURCE_WIDTH }}>
            Config source
          </TableColumnHeader>
          {showKeys && (
            <TableColumnHeader style={{ width: KEY_WIDTH }}>
              Overrides
            </TableColumnHeader>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {implementations.map((impl, i) => (
          <TableRow key={i}>
            <TableCell>
              <ExperimentCell impl={impl} />
            </TableCell>
            <TableCell>
              <StatusCell impl={impl} />
            </TableCell>
            <TableCell>
              <FeatureLink impl={impl} />
            </TableCell>
            <TableCell>
              <FlagRevisionBadge impl={impl} />
            </TableCell>
            <TableCell>
              <ConfigSourceCell impl={impl} />
            </TableCell>
            {showKeys && (
              <TableCell>
                <KeyCell keys={impl.keys} keyOrder={keyOrder} />
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// The "by key" view: each key spans its implementation rows (top-aligned key
// label, one clean divider at the group's bottom edge). Feature-rule and
// experiment rows share the same columns — the Experiment/Status cells are
// empty for plain rules. Built as a CSS grid so the header is page-sticky.
export function ByKeyUsageTable({
  groups,
}: {
  groups: { key: string; impls: DedupedImplementation[] }[];
}): React.ReactElement {
  return (
    <div className={styles.gridTable} role="table">
      <UsageGridHeader
        columns={BY_KEY_COLS}
        labels={[
          "Key",
          "Feature",
          "Status",
          "Experiment",
          null,
          "Location",
          "Config source",
          null,
        ]}
      />
      {groups.map(({ key, impls }) =>
        impls.map((impl, idx) => {
          const last = idx === impls.length - 1;
          return (
            <div
              key={`${key}|${idx}`}
              className={styles.row}
              style={{
                gridTemplateColumns: BY_KEY_COLS,
                borderBottom: last ? GROUP_BORDER : undefined,
              }}
              role="row"
            >
              <div role="cell">
                {idx === 0 && (
                  <code title={key} style={{ color: "var(--slate-12)" }}>
                    {key}
                  </code>
                )}
              </div>
              <div role="cell">
                <FeatureLink impl={impl} maxWidth="100%" />
              </div>
              <div role="cell">
                <FlagRevisionBadge impl={impl} />
              </div>
              <div role="cell">
                <ExperimentCell impl={impl} maxWidth="100%" />
              </div>
              <div role="cell">
                <StatusCell impl={impl} />
              </div>
              <div role="cell">{locationLabel(impl)}</div>
              <div role="cell">
                <ConfigSourceCell impl={impl} />
              </div>
              <div role="cell">
                <OverridePopoverTrigger impl={impl} keys={[key]} />
              </div>
            </div>
          );
        }),
      )}
    </div>
  );
}

// The "by reference" view: a flat grid, one bordered row per clickable
// reference (never collapsed — a draft row links to its own revision). The
// "Overrides" column lists the keys each row touches.
export function ByReferenceUsageTable({
  groups,
  keyOrder,
}: {
  groups: { featureId: string; impls: DedupedImplementation[] }[];
  keyOrder?: string[];
}): React.ReactElement {
  return (
    <div className={styles.gridTable} role="table">
      <UsageGridHeader
        columns={BY_REF_COLS}
        labels={[
          "Feature",
          "Overrides",
          "Status",
          "Experiment",
          null,
          "Location",
          "Config source",
          null,
        ]}
      />
      {groups.flatMap(({ impls }) =>
        impls.map((impl, idx) => (
          <div
            key={`${impl.featureId}|${idx}`}
            className={styles.row}
            style={{
              gridTemplateColumns: BY_REF_COLS,
              borderBottom: GROUP_BORDER,
            }}
            role="row"
          >
            <div role="cell">
              <FeatureLink impl={impl} maxWidth="100%" />
            </div>
            <div role="cell">
              <KeyCell keys={impl.keys} keyOrder={keyOrder} />
            </div>
            <div role="cell">
              <FlagRevisionBadge impl={impl} />
            </div>
            <div role="cell">
              <ExperimentCell impl={impl} maxWidth="100%" />
            </div>
            <div role="cell">
              <StatusCell impl={impl} />
            </div>
            <div role="cell">{locationLabel(impl)}</div>
            <div role="cell">
              <ConfigSourceCell impl={impl} />
            </div>
            <div role="cell">
              <OverridePopoverTrigger impl={impl} keys={impl.keys} />
            </div>
          </div>
        )),
      )}
    </div>
  );
}
