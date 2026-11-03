import { renderHook } from "@testing-library/react";
import { describe, it, beforeEach, vi, expect } from "vitest";
import useAccountPlanNotices from "@/components/Notices/useAccountPlanNotices";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

vi.mock("@/services/UserContext");
vi.mock("@/hooks/usePermissionsUtils");
vi.mock("@/services/track");

const titles = () =>
  renderHook(() => useAccountPlanNotices()).result.current.map((n) => n.title);

const canManageBilling = (allowed: boolean) =>
  // @ts-expect-error "partial test mock"
  vi.mocked(usePermissionsUtil).mockReturnValue({
    canManageBilling: () => allowed,
    canViewUsage: () => true,
  });

describe("useAccountPlanNotices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("warns, with an upgrade, when CDN usage is approaching", () => {
    vi.mocked(useUser).mockReturnValue({
      // @ts-expect-error "partial test mock"
      usage: { cdn: { lastUpdated: new Date(), status: "approaching" } },
      license: null,
      seatsInUse: 0,
    });
    canManageBilling(true);

    const [notice] = renderHook(() => useAccountPlanNotices()).result.current;
    expect(notice).toMatchObject({
      severity: "warning",
      title: "Approaching CDN usage limit",
      upgrade: { commercialFeature: "unlimited-cdn-usage" },
    });
  });

  it("warns, with an upgrade, when Event Forwarder usage is approaching", () => {
    vi.mocked(useUser).mockReturnValue({
      // @ts-expect-error "partial test mock"
      usage: {
        cdn: { lastUpdated: new Date(), status: "under" },
        eventForwarder: { lastUpdated: new Date(), status: "approaching" },
      },
      license: null,
      seatsInUse: 0,
    });
    canManageBilling(true);

    const [notice] = renderHook(() => useAccountPlanNotices()).result.current;
    expect(notice).toMatchObject({
      severity: "warning",
      title: expect.stringContaining("Approaching Event Forwarder event limit"),
      upgrade: { commercialFeature: "unlimited-event-forwarder-usage" },
    });
  });

  describe("enterprise license seat quota", () => {
    it("does not warn when seats are within the limit", () => {
      // @ts-expect-error "partial test mock"
      vi.mocked(useUser).mockReturnValue({
        license: { plan: "enterprise", seats: 15 },
        seatsInUse: 10,
      });
      canManageBilling(true);
      expect(titles()).not.toContain("License seat quota exceeded");
    });

    it("does not warn someone without billing permissions", () => {
      // @ts-expect-error "partial test mock"
      vi.mocked(useUser).mockReturnValue({
        license: { plan: "enterprise", seats: 5 },
        seatsInUse: 10,
      });
      canManageBilling(false);
      expect(titles()).not.toContain("License seat quota exceeded");
    });

    it("warns when seats surpass the limit", () => {
      // @ts-expect-error "partial test mock"
      vi.mocked(useUser).mockReturnValue({
        license: { plan: "enterprise", seats: 5 },
        seatsInUse: 10,
      });
      canManageBilling(true);
      expect(titles()).toContain("License seat quota exceeded");
    });

    it("warns when the license has no seat count", () => {
      // @ts-expect-error "partial test mock"
      vi.mocked(useUser).mockReturnValue({
        license: { plan: "enterprise" },
        seatsInUse: 10,
      });
      canManageBilling(true);
      expect(titles()).toContain("License seat quota exceeded");
    });
  });
});
