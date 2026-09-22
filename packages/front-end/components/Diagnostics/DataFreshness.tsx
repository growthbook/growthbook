import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { PiProhibitFill, PiWarningFill } from "react-icons/pi";
import { abbreviateAgo } from "shared/dates";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
/**
 * How long without data before it counts as stale.
 *
 * Defined here rather than in a caller because two surfaces now read it, and
 * re-exported by EventLogs/staleness so its "Stale" badge and "Stopped
 * arriving" filter still share the one definition — a second constant would let
 * a header contradict the table beneath it.
 */
export const STALE_AFTER_HOURS = 24;

const STALE_AFTER_MS = STALE_AFTER_HOURS * 60 * 60 * 1000;

export type FreshnessState = "cached" | "stale" | "failed";

// The local wrapper is gone: abbreviateAgo now emits "just now", "5 min. ago"
// and "2 hr. ago" itself, so every surface that shows an elapsed time gets the
// same words. Forking it here is what would let the two clocks on the
// Diagnostics tab drift apart.

interface Props {
  /** When the data currently on screen was fetched. Null before the first load. */
  updatedAt: Date | null;
  /** The last refresh failed; the reason is surfaced on hover. */
  error?: Error | null;
  /**
   * Leading word for the fresh state. Defaults to "Updated"; a surface whose
   * stamp sits beside a Refresh button says "Refreshed", because there the
   * stamp is about when the query ran rather than when the data changed.
   * Only the fresh state takes it — "Data from" and "Couldn't refresh" are
   * about the data and the request, not the action.
   */
  verb?: string;
  /**
   * Rendered before the text in the fresh state only. The stale and failed
   * states carry their own warning and error icons, which say more than a
   * neutral one would. Omitted renders no icon, which is what every existing
   * caller gets.
   */
  icon?: ReactNode;
  /**
   * What the fresh state says before anything has loaded. Defaults to "Not
   * loaded yet"; a surface whose action is "Run Query" says "Not run yet",
   * because nothing was ever going to load on its own.
   */
  emptyLabel?: string;
}

export function getFreshnessState({ updatedAt, error }: Props): FreshnessState {
  if (error) return "failed";
  if (updatedAt && Date.now() - updatedAt.getTime() > STALE_AFTER_MS) {
    return "stale";
  }
  return "cached";
}

/**
 * Three states, and deliberately no mode label: a query result is always some
 * amount behind, so the header never claims otherwise. A source that refreshes
 * itself shows it by keeping the timestamp small.
 *
 * Local rather than reusing QueriesLastRun, which is typed around QueryStatus
 * and SourceSnapshotRef — this data comes from SWR, which has no equivalent,
 * and synthesising a QueryStatus to satisfy the type would misrepresent where
 * the state came from. The icon, the abbreviateAgo() helper and the red/amber
 * colours are borrowed from it so this doesn't read as foreign.
 *
 * @/ui/Text's colours stop at text-high/mid/low, so the warning and error
 * states take their colour from a wrapping span (Text inherits when no color
 * prop is passed) rather than importing Radix Text directly, which lint
 * restricts.
 */
export default function DataFreshness({
  updatedAt,
  error,
  verb = "Updated",
  icon,
  emptyLabel = "Not loaded yet",
}: Props) {
  const state = getFreshnessState({ updatedAt, error });

  if (state === "failed") {
    return (
      <Tooltip content={error?.message || "The most recent refresh failed."}>
        <Flex align="center" gap="1" style={{ whiteSpace: "nowrap" }}>
          <PiProhibitFill size={14} color="var(--red-11)" />
          <span style={{ color: "var(--red-11)" }}>
            <Text size="sm">Couldn&apos;t refresh</Text>
          </span>
        </Flex>
      </Tooltip>
    );
  }

  if (state === "stale") {
    return (
      <Flex align="center" gap="1" style={{ whiteSpace: "nowrap" }}>
        <PiWarningFill size={14} color="var(--amber-11)" />
        <span style={{ color: "var(--amber-11)" }}>
          <Text size="sm">
            {updatedAt
              ? `Data from ${abbreviateAgo(updatedAt)}`
              : "Data is out of date"}
          </Text>
        </span>
      </Flex>
    );
  }

  return (
    <Flex align="center" gap="1" style={{ whiteSpace: "nowrap" }}>
      {icon}
      <Text size="sm" color="text-mid" whiteSpace="nowrap">
        {updatedAt ? `${verb} ${abbreviateAgo(updatedAt)}` : emptyLabel}
      </Text>
    </Flex>
  );
}
