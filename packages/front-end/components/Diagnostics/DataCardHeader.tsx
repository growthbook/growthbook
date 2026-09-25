import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowRight, PiArrowsClockwiseBold } from "react-icons/pi";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import DataFreshness from "./DataFreshness";
import styles from "./DataCardHeader.module.scss";

/**
 * A card header whose title sits inline with a freshness stamp and a Refresh
 * button. Shared by the Event Logs stream and the feature Diagnostics table so
 * the two are the same header rather than two that resemble each other.
 */
interface Props {
  title: string;
  /** Rendered as one quiet line under the title. Nothing renders when absent. */
  description?: string;

  updatedAt?: Date | null;
  error?: Error | null;

  refreshing?: boolean;
  onRefresh?: () => void;
  /** Leading word for the freshness stamp; see DataFreshness. */
  freshnessVerb?: string;
  /** Icon before the freshness stamp; see DataFreshness. */
  freshnessIcon?: ReactNode;
  /** Text before anything has loaded; see DataFreshness. */
  freshnessEmptyLabel?: string;

  /**
   * Label and icon for the refresh action. Both default to "Refresh" with a
   * clockwise arrow — correct for a surface re-reading cached data, wrong for
   * one that spends a warehouse query on every press.
   */
  refreshLabel?: string;
  refreshIcon?: ReactNode;

  /**
   * Replaces the freshness + Refresh group on the right. For a card whose
   * header should carry a different fact — e.g. when data last arrived rather
   * than when the query ran. Omitted keeps the default group, so existing
   * callers are unchanged.
   *
   * Passing `null` renders no right-hand group at all, for a header that is
   * only a title. That is distinct from omitting it: the check below is against
   * `undefined` rather than nullish, so `null` cannot fall through to a
   * freshness stamp reading "Not loaded yet" against a timestamp the caller
   * never passed.
   */
  actions?: ReactNode;

  /**
   * The rule under the header. On by default: inside a card it separates the
   * header from the content below it. A page-level row that already sits above
   * its own chrome turns it off, so the header does not read as the top of a
   * card it is not part of.
   */
  /**
   * Rendered immediately after the title, inside the block that holds it, and
   * baseline-aligned with it. For a fact that qualifies the heading — a count
   * of what the query returned — rather than a control, which belongs in
   * `actions` on the other side of the row.
   *
   * Omitted renders nothing, which is what every existing caller gets.
   */
  titleSuffix?: ReactNode;

  showDivider?: boolean;

  /** Embedded instances get a "View all" link back to the full page. */
  embedded?: boolean;
}

export default function DataCardHeader({
  title,
  description,
  updatedAt = null,
  error,
  refreshing = false,
  onRefresh,
  freshnessVerb,
  freshnessIcon,
  freshnessEmptyLabel,
  refreshLabel = "Refresh",
  refreshIcon,
  actions,
  titleSuffix,
  showDivider = true,
  embedded,
}: Props) {
  return (
    <>
      {/* The title is centred against the freshness text and Refresh button.
          The button (32px) is taller than the heading (24px), so this puts the
          title ~4px lower than Summary's, which has no control beside it to set
          a taller row. Intra-row alignment wins over matching the other card. */}
      {/* `wrap` so the right-hand group drops to its own line on a narrow
          card rather than squeezing the title block — which, with a suffix
          beside the title, would otherwise truncate a fact rather than a
          label. */}
      <Flex align="center" justify="between" gap="3" wrap="wrap">
        {/* Shrinkable, so the title is what gives way when the right-hand group
          runs out of room. */}
        <Box className={styles.titleBlock}>
          {titleSuffix ? (
            // Baseline, not centre: the suffix is set smaller than the
            // heading, and centring would leave the two sitting on different
            // lines of type.
            <Flex align="baseline" gap="2" wrap="wrap">
              <Heading as="h2" size="md" mb="0" title={title}>
                {title}
              </Heading>
              {titleSuffix}
            </Flex>
          ) : (
            <Heading as="h2" size="md" title={title}>
              {title}
            </Heading>
          )}
          {description ? (
            <Text size="sm" color="text-mid" title={description} truncate>
              {description}
            </Text>
          ) : null}
        </Box>

        <Flex align="center" gap="4" className={styles.controls}>
          {actions !== undefined ? (
            actions
          ) : (
            <>
              <DataFreshness
                updatedAt={updatedAt}
                error={error}
                verb={freshnessVerb}
                icon={freshnessIcon}
                emptyLabel={freshnessEmptyLabel}
              />

              {/* `loading` is the codebase's in-progress pattern: it renders
                Radix's spinner and blocks the click, so no separate disabled
                state or label swap is needed. */}
              {onRefresh ? (
                <Button
                  variant="soft"
                  onClick={onRefresh}
                  loading={refreshing}
                  icon={refreshIcon ?? <PiArrowsClockwiseBold aria-hidden />}
                  iconPosition="left"
                >
                  {refreshLabel}
                </Button>
              ) : null}
            </>
          )}

          {embedded ? (
            // TODO: once the stream's filters are URL-synced, carry the current
            // filter state through so "View all" lands on the same view rather
            // than the unfiltered page.
            <Link href="/event-logs">
              <Flex align="center" gap="1">
                View all
                <PiArrowRight aria-hidden />
              </Flex>
            </Link>
          ) : null}
        </Flex>
      </Flex>

      {/* Sits between the header and everything below it: the filter row,
          search and table are all content, not header. */}
      {showDivider ? <Box className={styles.divider} /> : null}
    </>
  );
}
