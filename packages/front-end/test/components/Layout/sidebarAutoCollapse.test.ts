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

  it("collapses for the AI panel on top of an expanded choice", () => {
    expect(isCollapsed(state(false, ["agentPanel"]))).toBe(true);
    expect(isAutoCollapsed(state(false, ["agentPanel"]))).toBe(true);
  });

  it("expands again once the panel closes", () => {
    expect(isCollapsed(state(false, []))).toBe(false);
  });

  it("leaves a collapsed choice to itself: the panel doesn't own it", () => {
    expect(isCollapsed(state(true, ["agentPanel"]))).toBe(true);
    expect(isAutoCollapsed(state(true, ["agentPanel"]))).toBe(false);
    expect(isCollapsed(state(true, []))).toBe(true);
  });

  it("stays expanded over the panel once you expanded over it", () => {
    expect(isCollapsed(state(false, ["agentPanel"], ["agentPanel"]))).toBe(
      false,
    );
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

  it("expanding over the panel keeps the choice and holds the nav open", () => {
    const next = toggleCollapse(state(false, ["agentPanel"]));
    expect(next).toEqual({
      preferCollapsed: false,
      expandedOver: ["agentPanel"],
    });
    expect(
      isCollapsed(
        state(next.preferCollapsed, ["agentPanel"], next.expandedOver),
      ),
    ).toBe(false);
  });

  it("expanding a saved collapse with the panel open saves expanded and stays open", () => {
    const next = toggleCollapse(state(true, ["agentPanel"]));
    expect(next).toEqual({
      preferCollapsed: false,
      expandedOver: ["agentPanel"],
    });
    expect(
      isCollapsed(
        state(next.preferCollapsed, ["agentPanel"], next.expandedOver),
      ),
    ).toBe(false);
  });

  it("collapsing while held open hands it back to the panel, unsaved", () => {
    const next = toggleCollapse(state(false, ["agentPanel"], ["agentPanel"]));
    expect(next).toEqual({ preferCollapsed: false, expandedOver: [] });
    expect(
      isAutoCollapsed(
        state(next.preferCollapsed, ["agentPanel"], next.expandedOver),
      ),
    ).toBe(true);
  });
});

describe("pruneExpandedOver", () => {
  it("keeps the panel while it's open", () => {
    const over: AutoCollapseTrigger[] = ["agentPanel"];
    expect(pruneExpandedOver(over, ["agentPanel"])).toBe(over);
  });

  it("drops it once the panel closes, so reopening collapses again", () => {
    const over = pruneExpandedOver(["agentPanel"], []);
    expect(over).toEqual([]);
    expect(isCollapsed(state(false, ["agentPanel"], over))).toBe(true);
  });
});
