import { ReactNode } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import {
  HEALTH_BAND_LABELS,
  NO_STARTS_SCORE_CAP,
  HealthBand,
  ScopeHealth,
  WIN_RATE_HEALTHY_RANGE,
  getHealthBand,
} from "shared/enterprise";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import Link from "@/ui/Link";

export const BAND_COLORS: Record<HealthBand, string> = {
  strong: "green",
  healthy: "violet",
  "needs-attention": "amber",
  "at-risk": "red",
};

export function InfoTip({ content }: { content: string }) {
  return (
    <Tooltip content={content}>
      <span style={{ display: "inline-flex", color: "var(--gray-10)" }}>
        <PiInfo size={13} />
      </span>
    </Tooltip>
  );
}

export function Change({
  value,
  label,
  format = (v) => v.toFixed(1),
}: {
  value: number | null;
  label: string;
  format?: (v: number) => string;
}) {
  if (value === null || !isFinite(value)) return null;
  const up = value >= 0;
  // Rounds to zero at the shown precision
  const flat = format(Math.abs(value)) === format(0);
  return (
    <span style={{ textAlign: "right", lineHeight: 1.2 }}>
      <span
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 600,
          color: flat
            ? "var(--gray-11)"
            : up
              ? "var(--green-11)"
              : "var(--red-11)",
        }}
      >
        {flat ? "No change" : `${up ? "▲" : "▼"} ${format(Math.abs(value))}`}
      </span>
      <span style={{ fontSize: 10, color: "var(--gray-10)" }}>{label}</span>
    </span>
  );
}

function Bar({ children }: { children: ReactNode }) {
  return (
    <Box
      mt="3"
      style={{
        position: "relative",
        height: 6,
        borderRadius: 3,
        background: "var(--gray-a3)",
        overflow: "visible",
      }}
    >
      {children}
    </Box>
  );
}

function Fill({ share }: { share: number }) {
  return (
    <Box
      style={{
        width: `${Math.min(Math.max(share, 0), 1) * 100}%`,
        height: "100%",
        borderRadius: 3,
        background: "var(--violet-9)",
      }}
    />
  );
}

function Tile({
  label,
  info,
  value,
  unit,
  change,
  bar,
}: {
  label: string;
  info: string;
  value: ReactNode;
  unit?: string;
  change: ReactNode;
  bar?: ReactNode;
}) {
  return (
    // The whole tile shows the definition, not just the icon
    <Tooltip content={info}>
      <Box
        px="4"
        pt="4"
        pb="3"
        style={{
          minWidth: 0,
          borderLeft: "1px solid var(--gray-a5)",
          cursor: "help",
        }}
      >
        <Flex align="center" gap="1">
          <Text
            size="sm"
            weight="semibold"
            color="text-mid"
            textTransform="uppercase"
          >
            {label}
          </Text>
          <span style={{ display: "inline-flex", color: "var(--gray-10)" }}>
            <PiInfo size={13} />
          </span>
        </Flex>
        <Flex justify="between" align="end" mt="1" gap="2">
          <span style={{ whiteSpace: "nowrap" }}>
            <span
              style={{ fontSize: 24, fontWeight: 700, color: "var(--gray-12)" }}
            >
              {value}
            </span>
            {unit && (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--gray-11)",
                }}
              >
                {" "}
                {unit}
              </span>
            )}
          </span>
          {change}
        </Flex>
        {bar}
      </Box>
    </Tooltip>
  );
}

const pct = (v: number | null) =>
  v === null ? "–" : `${Math.round(v * 100)}%`;
const diff = (a: number | null, b: number | null | undefined) =>
  a === null || b === null || b === undefined ? null : a - b;

export default function HealthHeadline({
  health,
  score,
  previous,
  previousScore,
  previousLabel,
  improvement,
  quality,
}: {
  health: ScopeHealth;
  score: number | null;
  previous: ScopeHealth | null;
  previousScore: number | null;
  previousLabel: string;
  improvement: ReactNode | null;
  // How to show the Quality tile when there's no score
  quality: { state: "on" } | { state: "off" | "locked"; action: ReactNode };
}) {
  const band = score === null ? null : getHealthBand(score);
  const color = band ? BAND_COLORS[band] : "gray";
  const [low, high] = WIN_RATE_HEALTHY_RANGE;

  return (
    <Box className="appbox" mb="2" style={{ overflow: "hidden" }}>
      <Flex
        px="5"
        py="4"
        gap="5"
        align="center"
        wrap="wrap"
        style={{ borderBottom: "1px solid var(--gray-a5)" }}
      >
        <Flex align="center" gap="4">
          <Flex
            align="center"
            justify="center"
            style={{
              width: 76,
              height: 76,
              borderRadius: 8,
              background: `var(--${color}-9)`,
              color: "white",
              fontSize: score === null ? 22 : 38,
              fontWeight: 700,
            }}
          >
            {score ?? "–"}
          </Flex>
          <Box>
            <Flex align="center" gap="1">
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: "var(--gray-12)",
                }}
              >
                Health score
              </span>
              <InfoTip
                content={`Average of the quality score of completed experiments and the healthy rate, or the healthy rate alone when quality scoring is off. Capped at ${NO_STARTS_SCORE_CAP} when no experiments started in the period. Velocity and win rate are tracked but not scored.`}
              />
            </Flex>
            <Text as="div" color="text-mid">
              {band
                ? `out of 100 · ${HEALTH_BAND_LABELS[band]}`
                : "Not enough data: needs 5 completed experiments"}
            </Text>
            {score !== null && previousScore !== null && (
              <Text as="div" size="sm" color="text-low">
                <span
                  style={{
                    fontWeight: 600,
                    color:
                      score >= previousScore
                        ? "var(--green-11)"
                        : "var(--red-11)",
                  }}
                >
                  {score >= previousScore ? "▲" : "▼"}{" "}
                  {Math.abs(score - previousScore)}
                </span>{" "}
                {previousLabel}
              </Text>
            )}
          </Box>
        </Flex>
        {improvement && (
          <Box
            pl="5"
            style={{
              flex: 1,
              minWidth: 280,
              maxWidth: 560,
              marginLeft: "auto",
              borderLeft: "1px solid var(--gray-a5)",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "var(--violet-11)",
              }}
            >
              Areas of improvement
            </span>
            <Box mt="1" style={{ fontSize: 13, lineHeight: 1.5 }}>
              {improvement}
            </Box>
          </Box>
        )}
      </Flex>
      {/* Shifted left so the first tile's divider is clipped */}
      <Grid columns={{ initial: "2", md: "4" }} style={{ marginLeft: -1 }}>
        <Tile
          label="Win rate"
          info="Share of completed experiments with a winning result. A much higher rate often means tests are too safe."
          value={pct(health.winRate)}
          change={
            <Change
              value={
                diff(health.winRate, previous?.winRate) === null
                  ? null
                  : (diff(health.winRate, previous?.winRate) ?? 0) * 100
              }
              format={(v) => `${v.toFixed(0)}pt`}
              label={previousLabel}
            />
          }
          bar={
            <Bar>
              <Box
                style={{
                  position: "absolute",
                  left: `${low * 100}%`,
                  width: `${(high - low) * 100}%`,
                  height: "100%",
                  background: "var(--green-a7)",
                }}
              />
              {health.winRate !== null && (
                <Box
                  style={{
                    position: "absolute",
                    left: `calc(${Math.min(health.winRate, 1) * 100}% - 1.5px)`,
                    top: -3,
                    width: 3,
                    height: 12,
                    background: "var(--gray-12)",
                  }}
                />
              )}
            </Bar>
          }
        />
        <Tile
          label="Velocity"
          info="Experiments started per month. Counts the first start only. Restarts don't count."
          value={health.startRate.toFixed(1)}
          unit="/ mo"
          change={
            <Change
              value={diff(health.startRate, previous?.startRate)}
              label={previousLabel}
            />
          }
        />
        <Tile
          label="Quality"
          info="Average quality score of completed experiments, from the checks in Experimentation Health settings."
          value={
            health.quality !== null
              ? Math.round(health.quality)
              : quality.state === "on"
                ? "–"
                : quality.action
          }
          unit={health.quality !== null ? "/ 100" : undefined}
          change={
            <Change
              value={diff(health.quality, previous?.quality)}
              format={(v) => v.toFixed(0)}
              label={previousLabel}
            />
          }
          bar={
            health.quality !== null ? (
              <Bar>
                <Fill share={health.quality / 100} />
              </Bar>
            ) : undefined
          }
        />
        <Tile
          label="Healthy rate"
          info="Share of completed experiments with no health errors (SRM or multiple exposures) and no missed power target. Experiments without a power target count as healthy."
          value={pct(health.healthyRate)}
          change={
            <Change
              value={
                diff(health.healthyRate, previous?.healthyRate) === null
                  ? null
                  : (diff(health.healthyRate, previous?.healthyRate) ?? 0) * 100
              }
              format={(v) => `${v.toFixed(0)}pt`}
              label={previousLabel}
            />
          }
          bar={
            health.healthyRate !== null ? (
              <Bar>
                <Fill share={health.healthyRate} />
              </Bar>
            ) : undefined
          }
        />
      </Grid>
    </Box>
  );
}

export function HeadlineLegend() {
  return (
    <Flex gap="4" mb="5" align="center">
      <Flex align="center" gap="1">
        <span style={{ width: 14, height: 6, background: "var(--green-a7)" }} />
        <Text size="sm" color="text-low">
          Healthy range (win rate)
        </Text>
      </Flex>
      <Flex align="center" gap="1">
        <span style={{ width: 3, height: 10, background: "var(--gray-12)" }} />
        <Text size="sm" color="text-low">
          Current value
        </Text>
      </Flex>
    </Flex>
  );
}

export function ImprovementLinks({
  links,
}: {
  links: { label: string; href: string }[];
}) {
  return (
    <Flex gap="3" mt="1">
      {links.map((l) => (
        <Link key={l.label} href={l.href} size="sm">
          {l.label}
        </Link>
      ))}
    </Flex>
  );
}
