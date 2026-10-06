import { ReactNode, useEffect, useState } from "react";
import { Flex, IconButton, Separator } from "@radix-ui/themes";
import { PiArrowSquareOut, PiInfo } from "react-icons/pi";
import { DEFAULT_TARGET_MDE } from "shared/constants";
import { getMetricLink } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { Popover } from "@/ui/Popover";
import Badge from "@/ui/Badge";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";
import styles from "./GoalMetricPopover.module.scss";

// A goal metric's chip opens this popover on click (set in review): the
// metric's name (linking to its page), its description, and its Target MDE,
// which can be overridden for this experiment. The override is the same one
// the Edit Target MDEs modal sets (decisionFrameworkMetricOverrides), so the
// two never disagree; here it goes into the page's draft and saves with Save.
//
// The default shown is the one the stats settings resolve to when there's no
// override (metricTargetMDEResolver): the metric's own Target MDE, else
// GrowthBook's 10%.

// The Edit Target MDEs modal's explanation.
const TARGET_MDE_INFO =
  "The Target Minimum Detectable Effect (MDE) is the smallest lift that you would like to reliably detect in the experiment. Smaller values require more data and longer run times, but the results will be more precise.";

function formatPercent(fraction: number): string {
  return `${parseFloat((fraction * 100).toFixed(4))}%`;
}

function MetricDetails({
  metricId,
  override,
  onChange,
}: {
  metricId: string;
  override: number | null;
  // Null removes the override. Without it, the popover is read-only.
  onChange?: (override: number | null) => void;
}) {
  const { getExperimentMetricById } = useDefinitions();
  const metric = getExperimentMetricById(metricId);
  const defaultValue = metric?.targetMDE ?? DEFAULT_TARGET_MDE;
  const overriding = override !== null;

  // The input's own text, so a half-typed number ("1.") isn't rewritten
  // under the cursor.
  const [input, setInput] = useState(
    String(parseFloat(((override ?? defaultValue) * 100).toFixed(4))),
  );
  useEffect(() => {
    if (override === null) return;
    setInput((prev) =>
      parseFloat(prev) / 100 === override
        ? prev
        : String(parseFloat((override * 100).toFixed(4))),
    );
  }, [override]);

  return (
    // The popover renders in a portal but, in React's tree, inside the
    // metric field, so its events would bubble up to react-select: Backspace
    // in the Target MDE input removed a chip, and a click could open the
    // metrics menu. They stop here. (Escape and outside clicks still close
    // the popover: Radix listens for those on the document.)
    <div
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Flex justify="between" align="center" gap="3">
        <Text weight="semibold">{metric?.name ?? metricId}</Text>
        {/* Styled exactly like the Setup page's pencil (EditButton), set in
          review, as a link. FALLBACK: Radix IconButton; @/ui/ has no icon
          button. */}
        <IconButton
          asChild
          className={styles.openLink}
          variant="ghost"
          color="gray"
          highContrast
          radius="full"
          size="2"
        >
          <a
            href={getMetricLink(metricId)}
            target="_blank"
            rel="noreferrer"
            aria-label="Open metric in a new tab"
          >
            <PiArrowSquareOut size="14" aria-hidden />
          </a>
        </IconButton>
      </Flex>
      <Separator size="4" my="3" className={styles.separator} />
      <Flex direction="column" gap="3">
        {metric?.description ? (
          <div>
            <div className={styles.sectionLabel}>Description</div>
            <div className={styles.description}>{metric.description}</div>
          </div>
        ) : null}
        <div>
          <div className={styles.sectionLabel}>
            Target MDE
            <Tooltip content={TARGET_MDE_INFO}>
              <span className={styles.info} aria-label={TARGET_MDE_INFO}>
                <PiInfo size={12} aria-hidden />
              </span>
            </Tooltip>
          </div>
          {overriding && onChange ? (
            <TextField
              size="md"
              type="number"
              min={0}
              step="any"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v) && v >= 0) onChange(v / 100);
              }}
              append="%"
              style={{ width: 120 }}
              aria-label="Target MDE"
              autoFocus
            />
          ) : (
            // "10% (Default)", set in review: whether the default is the
            // metric's own or GrowthBook's 10%.
            <div className={styles.value}>
              {formatPercent(override ?? defaultValue)}
              {overriding ? " (Overridden)" : " (Default)"}
            </div>
          )}
          {onChange ? (
            <div className={styles.checkbox}>
              <Checkbox
                value={overriding}
                setValue={(checked) => {
                  if (checked) {
                    setInput(
                      String(parseFloat((defaultValue * 100).toFixed(4))),
                    );
                    onChange(defaultValue);
                  } else {
                    onChange(null);
                  }
                }}
                label="Override default"
                weight="regular"
              />
            </div>
          ) : null}
        </div>
      </Flex>
    </div>
  );
}

export default function GoalMetricPopover({
  metricId,
  override,
  onChange,
  children,
  asBadge = false,
}: {
  metricId: string;
  override: number | null;
  onChange?: (override: number | null) => void;
  // The chip's label: the popover's trigger.
  children: ReactNode;
  // Read-only: the chip is a grey Badge (as the other read-only metric
  // chips are), with the name and MDE inside it. Otherwise the trigger is
  // the label inside the metric field's own chip.
  asBadge?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const { getExperimentMetricById } = useDefinitions();
  const { metricDefaults } = useOrganizationMetricDefaults();
  const metric = getExperimentMetricById(metricId);
  const name = metric?.name ?? metricId;
  // The MDE the experiment will use: the override, else the metric's own.
  const mdeValue = override ?? metric?.targetMDE ?? DEFAULT_TARGET_MDE;
  const mde = formatPercent(mdeValue);
  // Shown on the chip only when it isn't the org's default (Settings →
  // Metrics; GrowthBook's 10% if unset). There is no project-level default.
  // Every chip reading the same 10% hides the one that's different.
  const isCustom = mdeValue !== metricDefaults.targetMDE;
  // Inverse metrics (lower is better) point down.
  const inverse = !!metric?.inverse;
  const chipContent = (
    <>
      {/* The name gives way (truncates) before the arrow and MDE do. */}
      <span className={styles.triggerName}>{children}</span>
      {/* "(↑15%)", only when the MDE isn't the default; at the default the
        chip is just the name. No "≥": the MDE is what the experiment is
        powered to detect, not a bar a result must clear. The arrow is text
        (Inter's U+2191/U+2193), chosen over the Phosphor icon, set against
        the number, in parentheses (all set in review). */}
      {isCustom ? (
        <span className={styles.triggerMDE} aria-hidden>
          {`(${inverse ? "↓" : "↑"}${mde})`}
        </span>
      ) : null}
    </>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      // 4px below the chip (set in review).
      sideOffset={4}
      showArrow={false}
      contentClassName={styles.popover}
      // 16px all round (set in review), instead of the Popover's 15px 20px.
      contentStyle={{ padding: "var(--space-4)" }}
      content={
        <MetricDetails
          metricId={metricId}
          override={override}
          onChange={onChange}
        />
      }
      trigger={
        <button
          type="button"
          className={styles.trigger}
          // Inside the metric field, a mousedown would otherwise reach
          // react-select and open the metrics menu as well. Dragging to
          // reorder still works: that listens on the field itself.
          onMouseDown={(e) => e.stopPropagation()}
          // The symbols spelled out (set in review).
          aria-label={`${name}, ${inverse ? "decrease" : "increase"}, minimum detectable effect ${mde}`}
        >
          {/* "Click to view details" after a short hover (set in review),
            hidden while the popover is open. On the label, not the button:
            the button is already the popover's trigger. */}
          <Tooltip
            content="Click to view details"
            delayDuration={600}
            open={tooltipOpen && !open}
            onOpenChange={setTooltipOpen}
          >
            <span className={styles.tooltipAnchor}>
              {asBadge ? (
                // The MDE inside the read-only chip, as in the editable one
                // (fixed in review; it had been drawn beside the badge).
                <Badge
                  color="gray"
                  variant="soft"
                  className={styles.badgeChip}
                  style={{ maxWidth: "100%" }}
                  label={chipContent}
                />
              ) : (
                chipContent
              )}
            </span>
          </Tooltip>
        </button>
      }
    />
  );
}
