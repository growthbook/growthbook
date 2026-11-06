/**
 * When the app collapses the side nav for you, on top of your saved choice.
 * Nothing here is saved: after a reload your choice applies, then any active
 * trigger. Today the one trigger is the docked AI Assistant panel; the rules
 * hold for more.
 */
export type AutoCollapseTrigger = "agentPanel";

export type AutoCollapseState = {
  /** Your saved choice (the Collapse/Expand button). */
  preferCollapsed: boolean;
  /** The triggers active now. */
  activeTriggers: AutoCollapseTrigger[];
  /** Triggers you expanded the nav over; they don't collapse it again. */
  expandedOver: AutoCollapseTrigger[];
};

/** Collapsed by a trigger: one you haven't expanded over, unless you chose collapsed anyway. */
export function isAutoCollapsed({
  preferCollapsed,
  activeTriggers,
  expandedOver,
}: AutoCollapseState): boolean {
  return (
    !preferCollapsed && activeTriggers.some((t) => !expandedOver.includes(t))
  );
}

export function isCollapsed(state: AutoCollapseState): boolean {
  return state.preferCollapsed || isAutoCollapsed(state);
}

/**
 * The Collapse/Expand button. Expanding saves expanded and keeps the nav open
 * over the triggers active now. Collapsing while kept open over a trigger
 * hands it back to that trigger, unsaved; otherwise it saves collapsed.
 */
export function toggleCollapse(
  state: AutoCollapseState,
): Pick<AutoCollapseState, "preferCollapsed" | "expandedOver"> {
  if (isCollapsed(state)) {
    return { preferCollapsed: false, expandedOver: [...state.activeTriggers] };
  }
  if (state.activeTriggers.length) {
    return { preferCollapsed: state.preferCollapsed, expandedOver: [] };
  }
  return { preferCollapsed: true, expandedOver: [] };
}

/**
 * Drops triggers that have ended, so one that starts again collapses the nav
 * again.
 */
export function pruneExpandedOver(
  expandedOver: AutoCollapseTrigger[],
  activeTriggers: AutoCollapseTrigger[],
): AutoCollapseTrigger[] {
  const kept = expandedOver.filter((t) => activeTriggers.includes(t));
  return kept.length === expandedOver.length ? expandedOver : kept;
}
