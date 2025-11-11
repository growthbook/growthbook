import React from "react";
import { useRouter } from "next/router";
import { render, screen } from "@testing-library/react";
import { describe, it, beforeEach, vi, expect } from "vitest";
import AccountPlanNotices from "@/components/Layout/AccountPlanNotices";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

vi.mock("@/services/UserContext");
vi.mock("@/hooks/usePermissionsUtils");
vi.mock("@/services/track");
vi.mock("next/router", () => ({
  useRouter: vi.fn(),
}));

describe("AccountPlanNotices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error "partial test mock"
    vi.mocked(useRouter).mockReturnValue({
      push: vi.fn(),
      replace: vi.fn(),
      pathname: "/",
      query: {},
      asPath: "/",
      back: vi.fn(),
      prefetch: vi.fn(),
      isFallback: false,
      basePath: "",
      events: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      },
    });
  });

  it("renders a warning notification when CDN usage is approaching", () => {
    vi.mocked(useUser).mockReturnValue({
      // @ts-expect-error "partial test mock"
      usage: { cdn: { lastUpdated: new Date(), status: "approaching" } },
      license: null,
      seatsInUse: 0,
    });
    // @ts-expect-error "partial test mock"
    vi.mocked(usePermissionsUtil).mockReturnValue({
      canManageBilling: () => true,
      canViewUsage: () => true,
    });

    render(<AccountPlanNotices />);

    expect(
      screen.getByText(/Approaching CDN usage limit/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Upgrade license/i)).toBeInTheDocument();
  });

  describe("enterprise license seat quota", () => {
    it("does not render an error when seats is within limit", () => {
      // @ts-expect-error "partial test mock"
      vi.mocked(useUser).mockReturnValue({
        license: {
          plan: "enterprise",
          seats: 15,
        },
        seatsInUse: 10,
      });

      // @ts-expect-error "partial test mock"
      vi.mocked(usePermissionsUtil).mockReturnValue({
        canManageBilling: () => true,
        canViewUsage: () => true,
      });

      render(<AccountPlanNotices />);

      expect(
        screen.queryByText((content) =>
          content.includes("License seat quota exceeded"),
        ),
      ).not.toBeInTheDocument();
    });

    it("does not render an error if the user does not have billing permissions", () => {
      // @ts-expect-error "partial test mock"
      vi.mocked(useUser).mockReturnValue({
        license: {
          plan: "enterprise",
          seats: 5,
        },
        seatsInUse: 10,
      });

      // @ts-expect-error "partial test mock"
      vi.mocked(usePermissionsUtil).mockReturnValue({
        canManageBilling: () => false,
        canViewUsage: () => true,
      });

      render(<AccountPlanNotices />);

      expect(
        screen.queryByText((content) =>
          content.includes("License seat quota exceeded"),
        ),
      ).not.toBeInTheDocument();
    });

    it("renders an error when seats surpass limit", () => {
      // @ts-expect-error "partial test mock"
      vi.mocked(useUser).mockReturnValue({
        license: {
          plan: "enterprise",
          seats: 5,
        },
        seatsInUse: 10,
      });

      // @ts-expect-error "partial test mock"
      vi.mocked(usePermissionsUtil).mockReturnValue({
        canManageBilling: () => true,
        canViewUsage: () => true,
      });

      render(<AccountPlanNotices />);

      expect(
        screen.queryByText((content) =>
          content.includes("License seat quota exceeded"),
        ),
      ).toBeInTheDocument();
    });

    it("renders an error when license seats is undefined", () => {
      // @ts-expect-error "partial test mock"
      vi.mocked(useUser).mockReturnValue({
        license: {
          plan: "enterprise",
        },
        seatsInUse: 10,
      });

      // @ts-expect-error "partial test mock"
      vi.mocked(usePermissionsUtil).mockReturnValue({
        canManageBilling: () => true,
        canViewUsage: () => true,
      });

      render(<AccountPlanNotices />);

      expect(
        screen.queryByText((content) =>
          content.includes("License seat quota exceeded"),
        ),
      ).toBeInTheDocument();
    });
  });
});
