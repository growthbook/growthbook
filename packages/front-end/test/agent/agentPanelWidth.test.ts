import { describe, it, expect } from "vitest";
import {
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  SNAP_PAST_PX,
  clampPanelWidth,
  dragPanelWidth,
  keyPanelWidth,
  maxPanelWidth,
  panelWidthCss,
  parseSavedPanelWidth,
} from "@/components/Agent/agentPanelWidth";

describe("maxPanelWidth", () => {
  it("leaves the page 800px beside the side nav", () => {
    expect(maxPanelWidth(1400, 48)).toBe(552);
    expect(maxPanelWidth(1700, 240)).toBe(660);
  });

  it("caps at 720px on a wide window", () => {
    expect(maxPanelWidth(2560, 240)).toBe(PANEL_MAX_WIDTH);
  });

  it("never goes under the default, so a small window keeps today's width", () => {
    expect(maxPanelWidth(1100, 0)).toBe(PANEL_DEFAULT_WIDTH);
    expect(maxPanelWidth(1024, 0)).toBe(PANEL_DEFAULT_WIDTH);
  });
});

describe("clampPanelWidth", () => {
  it("keeps it between the minimum and the current widest", () => {
    expect(clampPanelWidth(200, 600)).toBe(PANEL_MIN_WIDTH);
    expect(clampPanelWidth(500, 600)).toBe(500);
    expect(clampPanelWidth(900, 600)).toBe(600);
  });
});

describe("panelWidthCss", () => {
  it("states the same limits for the browser to apply", () => {
    expect(panelWidthCss(480)).toBe(
      "clamp(360px, 480px, max(400px, min(720px, 100vw - var(--page-nav-width, 0px) - 800px)))",
    );
  });
});

describe("dragPanelWidth", () => {
  const base = { startWidth: 400, startX: 1000, max: 600 };

  it("widens as the edge moves left and narrows as it moves right", () => {
    expect(dragPanelWidth({ ...base, x: 900 })).toEqual({
      width: 500,
      pastSnap: false,
    });
    expect(dragPanelWidth({ ...base, x: 1020 })).toEqual({
      width: 380,
      pastSnap: false,
    });
    expect(dragPanelWidth({ ...base, x: 1100 })).toEqual({
      width: PANEL_MIN_WIDTH,
      pastSnap: false,
    });
  });

  it("holds at the widest; only well past it can a hold arm expanding", () => {
    expect(
      dragPanelWidth({ ...base, x: 1000 - 200 - SNAP_PAST_PX + 1 }),
    ).toEqual({ width: 600, pastSnap: false });
    expect(dragPanelWidth({ ...base, x: 1000 - 200 - SNAP_PAST_PX })).toEqual({
      width: 600,
      pastSnap: true,
    });
  });
});

describe("keyPanelWidth", () => {
  it("steps with the arrows, bigger with Shift", () => {
    expect(keyPanelWidth(400, "ArrowLeft", false, 600)).toBe(416);
    expect(keyPanelWidth(400, "ArrowRight", false, 600)).toBe(384);
    expect(keyPanelWidth(400, "ArrowLeft", true, 600)).toBe(464);
  });

  it("goes to the limits with Home and End, and stays within them", () => {
    expect(keyPanelWidth(400, "Home", false, 600)).toBe(PANEL_MIN_WIDTH);
    expect(keyPanelWidth(400, "End", false, 600)).toBe(600);
    expect(keyPanelWidth(590, "ArrowLeft", false, 600)).toBe(600);
  });

  it("ignores other keys", () => {
    expect(keyPanelWidth(400, "Enter", false, 600)).toBeNull();
  });
});

describe("parseSavedPanelWidth", () => {
  it("reads a width it could have saved", () => {
    expect(parseSavedPanelWidth("480")).toBe(480);
  });

  it("ignores a missing, broken or out-of-range one", () => {
    expect(parseSavedPanelWidth(null)).toBeNull();
    expect(parseSavedPanelWidth("wide")).toBeNull();
    expect(parseSavedPanelWidth("100")).toBeNull();
    expect(parseSavedPanelWidth("5000")).toBeNull();
  });
});
