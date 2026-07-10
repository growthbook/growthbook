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
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ConfigKeyImplementation } from "@/hooks/useConstantReferences";

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
  if (impl.location === "defaultValue") return "Default value";
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
          <Link href={`/configs/${impl.configKey}`} className="hover-underline">
            <OverflowText maxWidth={130} style={{ color: "var(--accent-11)" }}>
              {name}
            </OverflowText>
          </Link>
        </Flex>
      }
    />
  );
}

function FeatureLink({ featureId }: { featureId: string }): React.ReactElement {
  return (
    <Link href={`/features/${featureId}`} className="hover-underline">
      {featureId}
    </Link>
  );
}

// The config keys a row overrides — shown only in the flat "by reference" view,
// where a single reference can touch several keys.
function KeyCell({ keys }: { keys: string[] }): React.ReactElement {
  if (!keys.length)
    return (
      <Text size="small" color="text-low">
        —
      </Text>
    );
  return (
    <Text size="small">
      <code>{keys.join(", ")}</code>
    </Text>
  );
}

const LOCATION_WIDTH = 120;
const STATUS_WIDTH = 100;
const CONFIG_SOURCE_WIDTH = 190;
const FLAG_REVISION_WIDTH = 120;
const KEY_WIDTH = 200;
const FEATURE_WIDTH = 200;

export function FeatureUsageTable({
  implementations,
  showKeys = false,
}: {
  implementations: ConfigKeyImplementation[];
  showKeys?: boolean;
}): React.ReactElement {
  return (
    <Table variant="ghost" style={{ width: "max-content", maxWidth: "100%" }}>
      <TableHeader>
        <TableRow>
          <TableColumnHeader>Feature</TableColumnHeader>
          <TableColumnHeader style={{ width: LOCATION_WIDTH }}>
            Location
          </TableColumnHeader>
          <TableColumnHeader style={{ width: CONFIG_SOURCE_WIDTH }}>
            Config source
          </TableColumnHeader>
          <TableColumnHeader style={{ width: FLAG_REVISION_WIDTH }}>
            Flag revision
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
              <FeatureLink featureId={impl.featureId} />
            </TableCell>
            <TableCell>{locationLabel(impl)}</TableCell>
            <TableCell>
              <ConfigSourceCell impl={impl} />
            </TableCell>
            <TableCell>
              <FlagRevisionBadge impl={impl} />
            </TableCell>
            {showKeys && (
              <TableCell>
                <KeyCell keys={impl.keys} />
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
}: {
  implementations: ConfigKeyImplementation[];
  showKeys?: boolean;
}): React.ReactElement {
  return (
    <Table variant="ghost" style={{ width: "max-content", maxWidth: "100%" }}>
      <TableHeader>
        <TableRow>
          <TableColumnHeader>Experiment</TableColumnHeader>
          <TableColumnHeader style={{ width: STATUS_WIDTH }}>
            Status
          </TableColumnHeader>
          <TableColumnHeader style={{ width: FEATURE_WIDTH }}>
            Feature
          </TableColumnHeader>
          <TableColumnHeader style={{ width: CONFIG_SOURCE_WIDTH }}>
            Config source
          </TableColumnHeader>
          <TableColumnHeader style={{ width: FLAG_REVISION_WIDTH }}>
            Flag revision
          </TableColumnHeader>
          {showKeys && (
            <TableColumnHeader style={{ width: KEY_WIDTH }}>
              Overrides
            </TableColumnHeader>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {implementations.map((impl, i) => {
          const status = impl.experimentStatus;
          return (
            <TableRow key={i}>
              <TableCell>
                {impl.experimentId ? (
                  <Link
                    href={`/experiment/${impl.experimentId}`}
                    className="hover-underline"
                  >
                    {impl.experimentName ?? impl.experimentId}
                  </Link>
                ) : (
                  (impl.experimentName ?? "—")
                )}
              </TableCell>
              <TableCell>
                {status ? (
                  <Badge
                    color={EXPERIMENT_STATUS_COLORS[status] ?? "gray"}
                    variant="soft"
                    radius="full"
                    label={status.charAt(0).toUpperCase() + status.slice(1)}
                  />
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>
                <FeatureLink featureId={impl.featureId} />
              </TableCell>
              <TableCell>
                <ConfigSourceCell impl={impl} />
              </TableCell>
              <TableCell>
                <FlagRevisionBadge impl={impl} />
              </TableCell>
              {showKeys && (
                <TableCell>
                  <KeyCell keys={impl.keys} />
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
