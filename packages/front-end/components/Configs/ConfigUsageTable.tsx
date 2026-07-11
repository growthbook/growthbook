import React from "react";
import { Flex } from "@radix-ui/themes";
import {
  PiRadioButton,
  PiArrowBendLeftUp,
  PiArrowBendRightDown,
  PiArrowsLeftRight,
} from "react-icons/pi";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
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

// Collapse a rule's variation arms (each arm is its own implementation) into one
// row per reference, unioning the keys each arm overrides — otherwise a rule
// whose control arm overrides nothing would show no overrides.
export function dedupeImplementations(
  impls: ConfigKeyImplementation[],
): ConfigKeyImplementation[] {
  const bySignature = new Map<string, ConfigKeyImplementation>();
  for (const i of impls) {
    const k = [
      i.featureId,
      i.location,
      i.ruleId ?? "",
      i.experimentId ?? "",
      i.state,
    ].join("|");
    const existing = bySignature.get(k);
    if (existing) {
      existing.keys = [...new Set([...existing.keys, ...i.keys])];
    } else {
      bySignature.set(k, { ...i, keys: [...i.keys] });
    }
  }
  return [...bySignature.values()];
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
          impl.revisionVersion != null
            ? `Draft v${impl.revisionVersion}`
            : "Draft"
        }
      />
    );
  }
  return <Badge color="green" variant="soft" radius="full" label="Live" />;
}

const RELATION_ICON: Record<string, React.ReactNode> = {
  ancestor: <PiArrowBendLeftUp />,
  descendant: <PiArrowBendRightDown />,
  other: <PiArrowsLeftRight />,
};

// A @/ui/Link that truncates on the anchor itself (not a nested inline-block),
// so its hover underline actually reaches the text. Title carries the full value.
function TruncatedLink({
  href,
  maxWidth = "100%",
  color,
  children,
}: {
  href: string;
  // Number for fixed-width (Radix popover) cells; defaults to filling the cell,
  // which is what the flexible grid columns below want.
  maxWidth?: number | string;
  color?: string;
  children: string;
}): React.ReactElement {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      className="hover-underline"
      title={children}
      style={{
        display: "inline-block",
        maxWidth,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "bottom",
        color,
      }}
    >
      {children}
    </Link>
  );
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
        <Flex align="center" gap="1" style={{ minWidth: 0 }}>
          {RELATION_ICON[relation]}
          <TruncatedLink
            href={`/configs/${impl.configKey}`}
            maxWidth={130}
            color="var(--accent-11)"
          >
            {name}
          </TruncatedLink>
        </Flex>
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
    impl.state === "draft" && impl.revisionVersion != null
      ? `/features/${impl.featureId}?v=${impl.revisionVersion}`
      : `/features/${impl.featureId}`;
  return (
    <TruncatedLink href={href} maxWidth={maxWidth}>
      {impl.featureId}
    </TruncatedLink>
  );
}

// The linked experiment (empty for non-experiment rules).
function ExperimentCell({
  impl,
  maxWidth = EXPERIMENT_WIDTH - 30,
}: {
  impl: ConfigKeyImplementation;
  maxWidth?: number | string;
}): React.ReactElement | null {
  if (!impl.experimentId)
    return impl.experimentName ? (
      <Text size="small">{impl.experimentName}</Text>
    ) : null;
  return (
    <TruncatedLink
      href={`/experiment/${impl.experimentId}`}
      maxWidth={maxWidth}
    >
      {impl.experimentName ?? impl.experimentId}
    </TruncatedLink>
  );
}

// The experiment's lifecycle status (empty for non-experiment rules).
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

// The config keys a row overrides — shown only in the flat "by reference" view,
// where a single reference can touch several keys. Ordered to match the field
// list in the config table above; one key per line.
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
  return (
    <Flex direction="column" gap="1">
      {ordered.map((k) => (
        <code key={k} title={k} style={{ color: "var(--slate-12)" }}>
          {k}
        </code>
      ))}
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
// Columns: Key | Feature | Revision status | Experiment | Exp status | Location | Config source
const BY_KEY_COLS =
  "minmax(80px, 130px) minmax(120px, 1.2fr) 100px minmax(110px, 1fr) 90px 100px minmax(150px, 190px)";
// Columns: Feature | Overrides | Revision status | Experiment | Exp status | Location | Config source
const BY_REF_COLS =
  "minmax(120px, 1.2fr) minmax(120px, 190px) 100px minmax(110px, 1fr) 90px 100px minmax(150px, 190px)";

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
  groups: { key: string; impls: ConfigKeyImplementation[] }[];
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
  groups: { featureId: string; impls: ConfigKeyImplementation[] }[];
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
          </div>
        )),
      )}
    </div>
  );
}
