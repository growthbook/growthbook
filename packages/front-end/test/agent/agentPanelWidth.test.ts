import { describe, it, expect } from "vitest";
import {
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  SNAP_PAST_PX,
  canResizePanel,
  clampPanelWidth,
  dragPanelWidth,
  keyPanelWidth,
  maxPanelWidth,
  panelWidthCss,
  parseSavedPanelWidth,
} from "@/components/Agent/agentPanelWidth";

describe("limits", () => {
  it("opens at 400px and narrows to 300px", () => {
    expect(PANEL_DEFAULT_WIDTH).toBe(400);
    expect(PANEL_MIN_WIDTH).toBe(300);
  });
});

describe("maxPanelWidth", () => {
  it("leaves the page 540px beside the side nav", () => {
    expect(maxPanelWidth(1400, 240)).toBe(620);
    expect(maxPanelWidth(1400, 48)).toBe(812);
  });

  it("caps at 900px on a wide window", () => {
    expect(maxPanelWidth(1700, 240)).toBe(PANEL_MAX_WIDTH);
    expect(maxPanelWidth(1920, 48)).toBe(PANEL_MAX_WIDTH);
  });

  it("never goes under the minimum on a small window", () => {
    expect(maxPanelWidth(1100, 0)).toBe(560);
    expect(maxPanelWidth(800, 0)).toBe(PANEL_MIN_WIDTH);
  });
});

describe("canResizePanel", () => {
  it("only with room to resize it by at least a key step", () => {
    expect(canResizePanel(PANEL_MIN_WIDTH)).toBe(false);
    expect(canResizePanel(PANEL_MIN_WIDTH + 15)).toBe(false);
    expect(canResizePanel(PANEL_MIN_WIDTH + 16)).toBe(true);
    // Docked (from 1024px), there's always room.
    expect(canResizePanel(maxPanelWidth(1024, 0))).toBe(true);
  });
});

describe("clampPanelWidth", () => {
  it("keeps it between the minimum and the current widest", () => {
    expect(clampPanelWidth(300, 600)).toBe(PANEL_MIN_WIDTH);
    expect(clampPanelWidth(500, 600)).toBe(500);
    expect(clampPanelWidth(900, 600)).toBe(600);
  });
});

describe("panelWidthCss", () => {
  it("states the same limits for the browser to apply", () => {
    expect(panelWidthCss(480)).toBe(
      "clamp(300px, 480px, max(300px, min(900px, 100vw - var(--page-nav-width, 0px) - 540px)))",
    );
  });
});

describe("dragPanelWidth", () => {
  const base = { startWidth: 500, startX: 1000, max: 700 };

  it("widens as the edge moves left and narrows as it moves right, to the minimum", () => {
    expect(dragPanelWidth({ ...base, x: 900 })).toEqual({
      width: 600,
      pastSnap: false,
    });
    expect(dragPanelWidth({ ...base, x: 1050 })).toEqual({
      width: 450,
      pastSnap: false,
    });
    expect(dragPanelWidth({ ...base, x: 1200 })).toEqual({
      width: PANEL_MIN_WIDTH,
      pastSnap: false,
    });
  });

  it("holds at the widest; only well past it can a hold arm expanding", () => {
    expect(
      dragPanelWidth({ ...base, x: 1000 - 200 - SNAP_PAST_PX + 1 }),
    ).toEqual({ width: 700, pastSnap: false });
    expect(dragPanelWidth({ ...base, x: 1000 - 200 - SNAP_PAST_PX })).toEqual({
      width: 700,
      pastSnap: true,
    });
  });
});

describe("keyPanelWidth", () => {
  it("steps with the arrows, bigger with Shift", () => {
    expect(keyPanelWidth(500, "ArrowLeft", false, 700)).toBe(516);
    expect(keyPanelWidth(500, "ArrowRight", false, 700)).toBe(484);
    expect(keyPanelWidth(500, "ArrowLeft", true, 700)).toBe(564);
  });

  it("goes to the limits with Home and End, and stays within them", () => {
    expect(keyPanelWidth(500, "Home", false, 700)).toBe(PANEL_MIN_WIDTH);
    expect(keyPanelWidth(500, "End", false, 700)).toBe(700);
    expect(keyPanelWidth(690, "ArrowLeft", false, 700)).toBe(700);
    expect(keyPanelWidth(310, "ArrowRight", false, 700)).toBe(PANEL_MIN_WIDTH);
  });

  it("ignores other keys", () => {
    expect(keyPanelWidth(500, "Enter", false, 700)).toBeNull();
  });
});

describe("parseSavedPanelWidth", () => {
  it("reads a width it could have saved", () => {
    expect(parseSavedPanelWidth("480")).toBe(480);
    expect(parseSavedPanelWidth("900")).toBe(900);
  });

  it("ignores a missing, broken or out-of-range one", () => {
    expect(parseSavedPanelWidth(null)).toBeNull();
    expect(parseSavedPanelWidth("wide")).toBeNull();
    expect(parseSavedPanelWidth("250")).toBeNull();
    expect(parseSavedPanelWidth("5000")).toBeNull();
  });
});
