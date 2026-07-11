import React, { useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiFlagBold, PiFlaskBold } from "react-icons/pi";
import { Popover } from "@/ui/Popover";
import { ConfigKeyImplementation } from "@/hooks/useConstantReferences";
import {
  dedupeImplementations,
  stateDots,
  experimentStatusColor,
  FeatureUsageTable,
  ExperimentUsageTable,
} from "./ConfigUsageTable";

function UsageBadge({
  icon,
  count,
  color,
  dots,
  content,
}: {
  icon: React.ReactNode;
  count: number;
  // Radix color scale for the badge background/text (e.g. "slate", "green").
  color: string;
  // Flag-revision dots shown inside the badge (green = live, amber = draft).
  dots: string[];
  content: React.ReactNode;
}): React.ReactElement {
  return (
    <Popover
      side="right"
      align="start"
      openOnHover
      triggerAsChild
      trigger={
        <button
          type="button"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            flexShrink: 0,
            border: "none",
            cursor: "pointer",
            padding: "0 7px",
            height: 22,
            borderRadius: 11,
            background: `var(--${color}-a3)`,
            color: `var(--${color}-11)`,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {icon}
          {count}
          {dots.length > 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                marginLeft: 2,
              }}
            >
              {dots.map((bg) => (
                <span
                  key={bg}
                  style={{
                    display: "block",
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: bg,
                  }}
                />
              ))}
            </span>
          )}
        </button>
      }
      content={
        <Box style={{ width: "min(88vw, 720px)", overflowX: "auto" }}>
          {content}
        </Box>
      }
    />
  );
}

// Per-key usage: an (uncolored) badge for feature-rule / default-value
// implementations, and an experiment badge colored by the most severe
// experiment status. Both carry flag-revision dots and open a table drill-down.
export default function ConfigKeyUsageBadge({
  implementations,
}: {
  implementations: ConfigKeyImplementation[];
}): React.ReactElement | null {
  const deduped = useMemo(
    () => dedupeImplementations(implementations),
    [implementations],
  );
  // A contextual-bandit-ref carries contextualBanditId (not experimentId) but
  // belongs with experiments, not plain feature rules.
  const isExperimentLike = (i: ConfigKeyImplementation) =>
    !!i.experimentId || !!i.contextualBanditId;
  const featureImpls = deduped.filter((i) => !isExperimentLike(i));
  const experimentImpls = deduped.filter(isExperimentLike);
  if (!featureImpls.length && !experimentImpls.length) return null;

  return (
    <Flex align="center" gap="2" wrap="wrap">
      {featureImpls.length > 0 && (
        <UsageBadge
          icon={<PiFlagBold size={13} />}
          count={featureImpls.length}
          color="slate"
          dots={stateDots(featureImpls)}
          content={<FeatureUsageTable implementations={featureImpls} />}
        />
      )}
      {experimentImpls.length > 0 && (
        <UsageBadge
          icon={<PiFlaskBold size={13} />}
          count={experimentImpls.length}
          color={experimentStatusColor(experimentImpls)}
          dots={stateDots(experimentImpls)}
          content={<ExperimentUsageTable implementations={experimentImpls} />}
        />
      )}
    </Flex>
  );
}
