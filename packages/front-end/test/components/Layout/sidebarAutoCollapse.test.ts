import { describe, it, expect } from "vitest";
import {
  AutoCollapseState,
  AutoCollapseTrigger,
  isAutoCollapsed,
  isCollapsed,
  pruneExpandedOver,
  toggleCollapse,
} from "@/components/Layout/sidebarAutoCollapse";

const state = (
  preferCollapsed: boolean,
  activeTriggers: AutoCollapseTrigger[] = [],
  expandedOver: AutoCollapseTrigger[] = [],
): AutoCollapseState => ({ preferCollapsed, activeTriggers, expandedOver });

describe("isCollapsed", () => {
  it("follows the saved choice with no trigger", () => {
    expect(isCollapsed(state(false))).toBe(false);
    expect(isCollapsed(state(true))).toBe(true);
  });

  it("collapses for a trigger on top of an expanded choice", () => {
    expect(isCollapsed(state(false, ["settings"]))).toBe(true);
    expect(isAutoCollapsed(state(false, ["agentPanel"]))).toBe(true);
  });

  it("leaves a collapsed choice to itself: a trigger doesn't own it", () => {
    expect(isCollapsed(state(true, ["settings"]))).toBe(true);
    expect(isAutoCollapsed(state(true, ["settings"]))).toBe(false);
  });

  it("stays expanded over a trigger you expanded over", () => {
    expect(isCollapsed(state(false, ["settings"], ["settings"]))).toBe(false);
  });

  it("collapses for a trigger you didn't expand over", () => {
    expect(
      isCollapsed(state(false, ["settings", "agentPanel"], ["settings"])),
    ).toBe(true);
  });

  it("stays collapsed until neither of two triggers is active", () => {
    expect(isCollapsed(state(false, ["settings", "agentPanel"]))).toBe(true);
    expect(isCollapsed(state(false, ["settings"]))).toBe(true);
    expect(isCollapsed(state(false, ["agentPanel"]))).toBe(true);
    expect(isCollapsed(state(false, []))).toBe(false);
  });
});

describe("toggleCollapse", () => {
  it("saves the choice with no trigger", () => {
    expect(toggleCollapse(state(false))).toEqual({
      preferCollapsed: true,
      expandedOver: [],
    });
    expect(toggleCollapse(state(true))).toEqual({
      preferCollapsed: false,
      expandedOver: [],
    });
  });

  it("expanding over a trigger keeps the choice and holds the nav open", () => {
    const next = toggleCollapse(state(false, ["settings"]));
    expect(next).toEqual({
      preferCollapsed: false,
      expandedOver: ["settings"],
    });
    expect(
      isCollapsed(state(next.preferCollapsed, ["settings"], next.expandedOver)),
    ).toBe(false);
  });

  it("expanding a saved collapse during a trigger saves expanded and stays open", () => {
    const next = toggleCollapse(state(true, ["settings"]));
    expect(next).toEqual({
      preferCollapsed: false,
      expandedOver: ["settings"],
    });
    expect(
      isCollapsed(state(next.preferCollapsed, ["settings"], next.expandedOver)),
    ).toBe(false);
  });

  it("collapsing while held open hands it back to the trigger, unsaved", () => {
    const next = toggleCollapse(state(false, ["settings"], ["settings"]));
    expect(next).toEqual({ preferCollapsed: false, expandedOver: [] });
    expect(
      isAutoCollapsed(
        state(next.preferCollapsed, ["settings"], next.expandedOver),
      ),
    ).toBe(true);
  });
});

describe("pruneExpandedOver", () => {
  it("keeps triggers still active", () => {
    const over: AutoCollapseTrigger[] = ["settings", "agentPanel"];
    expect(pruneExpandedOver(over, ["settings", "agentPanel"])).toBe(over);
  });

  it("drops ended triggers, so starting again collapses again", () => {
    const over = pruneExpandedOver(["settings", "agentPanel"], ["settings"]);
    expect(over).toEqual(["settings"]);
    expect(isCollapsed(state(false, ["settings", "agentPanel"], over))).toBe(
      true,
    );
  });

  it("empties once no trigger is active", () => {
    expect(pruneExpandedOver(["settings"], [])).toEqual([]);
  });
});
