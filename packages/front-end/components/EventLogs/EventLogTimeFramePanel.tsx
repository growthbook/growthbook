import { Box, Flex } from "@radix-ui/themes";
import { datetime } from "shared/dates";
import { calculateProductAnalyticsDateRange } from "shared/enterprise";
import DatePicker from "@/components/DatePicker";
import Text from "@/ui/Text";
import styles from "./EventLogTimeFramePanel.module.scss";

/**
 * Mirror of MAX_RECORDS_WINDOW_HOURS in
 * packages/back-end/src/models/EventLogModel.ts, which is module-private and so
 * cannot be imported (and would cross the front-end/back-end package boundary
 * even if it were exported).
 *
 * MUST STAY IN SYNC. If the back-end cap is raised, raise this too — otherwise
 * the UI keeps clamping ranges the endpoint would now accept. If it is lowered
 * and this is not, the endpoint starts rejecting ranges the UI let the user
 * build, which is the failure this constant exists to prevent.
 */
export const MAX_RECORDS_WINDOW_HOURS = 24;

const CAP_MS = MAX_RECORDS_WINDOW_HOURS * 60 * 60 * 1000;

export type TimeFramePresetId = "1h" | "6h" | "24h" | "custom";

/**
 * A plain local array, deliberately not the shared `dateRangePredefined` enum.
 * That enum is persisted on ExplorationConfig and shared with the dashboard, so
 * adding a variant for this surface would have changed a stored shape for every
 * consumer — which is exactly why a custom row could not be added before.
 *
 * `hours` is omitted for the custom row: it has no fixed span.
 */
export const TIME_FRAME_PRESETS: {
  id: TimeFramePresetId;
  label: string;
  hours?: number;
}[] = [
  { id: "1h", label: "Last hour", hours: 1 },
  { id: "6h", label: "Last 6 hours", hours: 6 },
  { id: "24h", label: "Last 24 hours", hours: 24 },
  { id: "custom", label: "Custom…" },
];

/**
 * Absolute timestamps are ISO strings rather than Dates so the value compares
 * by JSON.stringify — the filter panel's draft/applied dirty check relies on
 * that, and two Dates for the same instant are never ===.
 */
export type EventLogTimeFrame =
  | { kind: "preset"; id: Exclude<TimeFramePresetId, "custom"> }
  | { kind: "custom"; from: string | null; to: string | null };

export const DEFAULT_TIME_FRAME: EventLogTimeFrame = {
  kind: "preset",
  id: "1h",
};

/** A custom frame is only queryable once both bounds are set. */
export function isCompleteTimeFrame(frame: EventLogTimeFrame): boolean {
  return frame.kind === "preset" || (!!frame.from && !!frame.to);
}

function presetHours(id: TimeFramePresetId): number {
  return TIME_FRAME_PRESETS.find((p) => p.id === id)?.hours ?? 1;
}

/**
 * Presets go through the shared resolver so they behave exactly as they did
 * before this panel existed — `customLookback` with an hour unit is the one
 * branch that stays on instants rather than snapping to UTC day boundaries.
 *
 * Custom ranges deliberately do NOT. The shared resolver's `customDateRange`
 * branch forces start to 00:00:00.000 and end to 23:59:59.999 UTC, so every
 * custom range would come back as a whole day or more — always over the 24h
 * cap, and never the minute-precise window the user picked.
 */
export function resolveEventLogTimeFrame(frame: EventLogTimeFrame): {
  startDate: Date;
  endDate: Date;
} {
  if (frame.kind === "custom" && frame.from && frame.to) {
    return { startDate: new Date(frame.from), endDate: new Date(frame.to) };
  }
  const hours =
    frame.kind === "preset" ? presetHours(frame.id) : presetHours("1h");
  return calculateProductAnalyticsDateRange({
    predefined: "customLookback",
    lookbackValue: hours,
    lookbackUnit: "hour",
  });
}

/**
 * What the trigger says when the panel is closed. Uses shared/dates `datetime`
 * — the app's standard "MMM d, yyyy, h:mm AM" — rather than inventing a format
 * for this one control.
 */
export function formatTimeFrameLabel(frame: EventLogTimeFrame): string {
  if (frame.kind === "preset") {
    return (
      TIME_FRAME_PRESETS.find((p) => p.id === frame.id)?.label ?? "Custom…"
    );
  }
  if (!frame.from || !frame.to) return "Custom…";
  return `${datetime(frame.from)} – ${datetime(frame.to)}`;
}

interface Props {
  value: EventLogTimeFrame;
  /** Draft only — the filter panel's Apply is what queries. */
  onChange: (frame: EventLogTimeFrame) => void;
}

export default function EventLogTimeFramePanel({ value, onChange }: Props) {
  const selectedId: TimeFramePresetId =
    value.kind === "custom" ? "custom" : value.id;

  const from =
    value.kind === "custom" && value.from ? new Date(value.from) : null;
  const to = value.kind === "custom" && value.to ? new Date(value.to) : null;

  const choosePreset = (id: TimeFramePresetId) => {
    if (id === "custom") {
      // Seeded from whatever is currently selected, so the two fields open on a
      // valid range instead of empty. Picking Custom is a request to adjust the
      // current window, not to start from nothing.
      const resolved = resolveEventLogTimeFrame(value);
      onChange({
        kind: "custom",
        from: resolved.startDate.toISOString(),
        to: resolved.endDate.toISOString(),
      });
      return;
    }
    onChange({ kind: "preset", id });
  };

  /**
   * Clamping, not erroring. The calendar's own bounds work at day granularity
   * (react-day-picker's `before`/`after` matchers take whole days), so they
   * stop a wildly wrong pick but cannot enforce an hours-level cap on their
   * own — these two setters do that.
   *
   * The bound that moves is always the *other* one. Bounding From from below
   * instead would trap the user: with a 24h maximum they could never slide the
   * window earlier without first moving To.
   */
  const setFrom = (d: Date | undefined) => {
    if (!d) {
      onChange({
        kind: "custom",
        from: null,
        to: to ? to.toISOString() : null,
      });
      return;
    }
    const now = Date.now();
    const nextFrom = Math.min(d.getTime(), now);
    let nextTo = to ? to.getTime() : null;
    if (nextTo !== null && nextTo - nextFrom > CAP_MS) {
      nextTo = Math.min(nextFrom + CAP_MS, now);
    }
    onChange({
      kind: "custom",
      from: new Date(nextFrom).toISOString(),
      to: nextTo === null ? null : new Date(nextTo).toISOString(),
    });
  };

  const setTo = (d: Date | undefined) => {
    if (!d) {
      onChange({
        kind: "custom",
        from: from ? from.toISOString() : null,
        to: null,
      });
      return;
    }
    const now = Date.now();
    const nextTo = Math.min(d.getTime(), now);
    let nextFrom = from ? from.getTime() : null;
    if (nextFrom !== null && nextTo - nextFrom > CAP_MS) {
      nextFrom = nextTo - CAP_MS;
    }
    onChange({
      kind: "custom",
      from: nextFrom === null ? null : new Date(nextFrom).toISOString(),
      to: new Date(nextTo).toISOString(),
    });
  };

  const now = new Date();

  return (
    <Box className={styles.panel}>
      {/* Real buttons with aria-pressed rather than divs with onClick: the rail
          is a set of toggles, and assistive tech has no way to read selection
          off a background colour. */}
      <Flex
        direction="column"
        className={styles.presetList}
        role="group"
        aria-label="Time frame presets"
      >
        {TIME_FRAME_PRESETS.map((preset) => {
          const active = selectedId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              className={`${styles.preset} ${active ? styles.presetActive : ""}`}
              onClick={() => choosePreset(preset.id)}
            >
              {preset.label}
            </button>
          );
        })}
      </Flex>

      {value.kind === "custom" ? (
        <Box className={styles.custom}>
          {/* Two single-date pickers rather than one range instance. Range mode
              renders a single text field carrying both dates, which can show
              only one label and takes typed "yyyy-MM-ddTHH:mm - yyyy-MM-ddTHH:mm"
              input; single mode renders a native datetime-local field per bound,
              which is what minute precision inside a 24h cap needs. */}
          <DatePicker
            id="event-log-timeframe-from"
            label="From"
            date={from ?? undefined}
            setDate={setFrom}
            precision="datetime"
            compact
            // Never later than the end of the window, or than now when the end
            // is not set yet.
            disableAfter={to ?? now}
            containerClassName={styles.dateField}
          />
          <DatePicker
            id="event-log-timeframe-to"
            label="To"
            date={to ?? undefined}
            setDate={setTo}
            precision="datetime"
            compact
            disableBefore={from ?? undefined}
            // Never later than now: there is nothing to read from the future.
            disableAfter={now}
            containerClassName={styles.dateField}
          />
          <Text size="sm" color="text-low">
            Ranges are capped at {MAX_RECORDS_WINDOW_HOURS} hours.
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
