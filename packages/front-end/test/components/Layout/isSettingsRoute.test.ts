import { describe, it, expect } from "vitest";
import { isSettingsRoute } from "@/components/Layout/sidebarNav";

describe("isSettingsRoute", () => {
  it("matches Settings pages, including detail routes", () => {
    expect(isSettingsRoute("/settings")).toBe(true);
    expect(isSettingsRoute("/settings/team")).toBe(true);
    expect(isSettingsRoute("/settings/team/[tid]")).toBe(true);
    expect(isSettingsRoute("/settings/webhooks/event/[eventwebhookid]")).toBe(
      true,
    );
  });

  it("matches the Settings pages that live outside /settings", () => {
    expect(isSettingsRoute("/projects")).toBe(true);
    expect(isSettingsRoute("/project/[pid]")).toBe(true);
    expect(isSettingsRoute("/events")).toBe(true);
    expect(isSettingsRoute("/events/[eventid]")).toBe(true);
    expect(isSettingsRoute("/integrations/slack")).toBe(true);
    expect(isSettingsRoute("/importing")).toBe(true);
  });

  it("does not match other pages", () => {
    expect(isSettingsRoute("/")).toBe(false);
    expect(isSettingsRoute("/features")).toBe(false);
    expect(isSettingsRoute("/admin")).toBe(false);
    expect(isSettingsRoute("/experiment/[eid]")).toBe(false);
  });
});
