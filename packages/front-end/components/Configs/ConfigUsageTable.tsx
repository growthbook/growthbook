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
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ConfigKeyImplementation } from "@/hooks/useConstantReferences";

// Shared row formats for config-key usage, rendered both in the per-key hover
// popover and (later) in grouped tables below the config editor.

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
// row per reference.
export function dedupeImplementations(
  impls: ConfigKeyImplementation[],
): ConfigKeyImplementation[] {
  const seen = new Set<string>();
  return impls.filter((i) => {
    const k = [
      i.featureId,
      i.location,
      i.ruleId ?? "",
      i.experimentId ?? "",
      i.state,
    ].join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "4px 20px 4px 0",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.3,
  textTransform: "uppercase",
  color: "var(--slate-11)",
  whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = {
  padding: "6px 20px 6px 0",
  borderTop: "1px solid var(--slate-a3)",
  verticalAlign: "top",
  whiteSpace: "nowrap",
};

function FeatureLink({ featureId }: { featureId: string }): React.ReactElement {
  return (
    <Link href={`/features/${featureId}`} className="hover-underline">
      <OverflowText maxWidth={170}>{featureId}</OverflowText>
    </Link>
  );
}

export function FeatureUsageTable({
  implementations,
}: {
  implementations: ConfigKeyImplementation[];
}): React.ReactElement {
  return (
    <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          <th style={thStyle}>Feature</th>
          <th style={thStyle}>Location</th>
          <th style={thStyle}>Config source</th>
          <th style={thStyle}>Flag revision</th>
        </tr>
      </thead>
      <tbody>
        {implementations.map((impl, i) => (
          <tr key={i}>
            <td style={tdStyle}>
              <FeatureLink featureId={impl.featureId} />
            </td>
            <td style={tdStyle}>{locationLabel(impl)}</td>
            <td style={tdStyle}>
              <ConfigSourceCell impl={impl} />
            </td>
            <td style={tdStyle}>
              <FlagRevisionBadge impl={impl} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ExperimentUsageTable({
  implementations,
}: {
  implementations: ConfigKeyImplementation[];
}): React.ReactElement {
  return (
    <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          <th style={thStyle}>Experiment</th>
          <th style={thStyle}>Status</th>
          <th style={thStyle}>Feature</th>
          <th style={thStyle}>Config source</th>
          <th style={thStyle}>Flag revision</th>
        </tr>
      </thead>
      <tbody>
        {implementations.map((impl, i) => {
          const status = impl.experimentStatus;
          return (
            <tr key={i}>
              <td style={tdStyle}>
                {impl.experimentId ? (
                  <Link
                    href={`/experiment/${impl.experimentId}`}
                    className="hover-underline"
                  >
                    <OverflowText maxWidth={160}>
                      {impl.experimentName ?? impl.experimentId}
                    </OverflowText>
                  </Link>
                ) : (
                  (impl.experimentName ?? "—")
                )}
              </td>
              <td style={tdStyle}>
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
              </td>
              <td style={tdStyle}>
                <FeatureLink featureId={impl.featureId} />
              </td>
              <td style={tdStyle}>
                <ConfigSourceCell impl={impl} />
              </td>
              <td style={tdStyle}>
                <FlagRevisionBadge impl={impl} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
