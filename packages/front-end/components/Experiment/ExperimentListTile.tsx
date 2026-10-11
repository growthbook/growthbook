import { Flex } from "@radix-ui/themes";
import { PiArrowDownBold, PiArrowUpBold } from "react-icons/pi";
import { TabsTrigger } from "@/ui/Tabs";
import Text from "@/ui/Text";
import Sparkline from "@/components/Experiment/Sparkline";
import styles from "./ExperimentListTile.module.scss";

// One of the experiments list's attention tiles (set in review; in place
// of its tabs): a tab, drawn as a card with its name, how many experiments
// it holds and, unless showTrend is off (All), the change over the last 30
// days and an 8-week sparkline. Still a tab underneath (@/ui/Tabs'
// trigger), so it selects the table below and works from the keyboard.
// Prototype trend data: see services/experimentListTiles.
export default function ExperimentListTile({
  value,
  label,
  count,
  series = [],
  changePercent = null,
  showTrend = true,
  valence = "neutral",
}: {
  value: string;
  label: string;
  count: number;
  series?: number[];
  changePercent?: number | null;
  showTrend?: boolean;
  // What the trend's direction means: "up-is-worse" (Needs Decision,
  // Unhealthy) or "neutral" (Ending soon).
  valence?: "up-is-worse" | "neutral";
}) {
  // The trend's colour says better or worse, not up or down (set in
  // review); the arrow carries the direction. With up-is-worse, rising is
  // rust (Radix orange) and falling green; neutral, or no change to show, is
  // grey. The line in the scale's step 9; the change figure in step 11, for
  // contrast as text.
  const trend =
    valence === "neutral" || changePercent === null
      ? "slate"
      : changePercent > 0
        ? "orange"
        : "green";

  return (
    <TabsTrigger value={value} className={styles.tile}>
      <Flex direction="column" gap="1">
        {/* The name: 12px (set in review; was 14px) in --slate-11,
          softer than the count. */}
        <span style={{ color: "var(--slate-11)" }}>
          <Text size="sm">{label}</Text>
        </span>
        <Flex justify="between" align="end" gap="3">
          <Flex align="baseline" gap="2" style={{ minWidth: 0 }}>
            {/* The count: 24px, the page heading's size (set in review,
              trying it; was 28px), at 400 (was 500, the heading's weight). */}
            <span
              style={{
                fontSize: "var(--font-size-6)",
                lineHeight: 1.15,
                fontWeight: 400,
                color: "var(--gray-12)",
              }}
            >
              {count}
            </span>
            {/* The 30-day change: an arrow and a percentage, 12px at 500,
              in the trend's colour. */}
            {showTrend && changePercent !== null ? (
              <span
                aria-label={`${changePercent > 0 ? "Up" : "Down"} ${Math.abs(
                  changePercent,
                )}% in 30 days`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 2,
                  fontSize: "var(--font-size-1)",
                  fontWeight: 500,
                  color: `var(--${trend}-11)`,
                  whiteSpace: "nowrap",
                }}
              >
                {changePercent > 0 ? (
                  <PiArrowUpBold size={10} aria-hidden />
                ) : (
                  <PiArrowDownBold size={10} aria-hidden />
                )}
                {Math.abs(changePercent)}%
              </span>
            ) : null}
          </Flex>
          {/* The 8-week trend, coloured by its direction (above), 60 by
            20px (set in review; tried 80, 74 and 68 by 28px, and 60 by
            24px). */}
          {showTrend && series.length ? (
            <span aria-hidden style={{ flexShrink: 0 }}>
              <Sparkline
                data={series}
                width={60}
                height={20}
                color={`var(--${trend}-9)`}
              />
            </span>
          ) : null}
        </Flex>
      </Flex>
    </TabsTrigger>
  );
}
