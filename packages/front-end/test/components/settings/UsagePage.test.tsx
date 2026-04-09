import { render, screen } from "@testing-library/react";
import { describe, it, beforeEach, expect, vi } from "vitest";
import UsagePage from "@/pages/settings/usage";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";

vi.mock("@/hooks/usePermissionsUtils");
vi.mock("@/services/UserContext");
vi.mock("@/components/Settings/Usage/CloudUsage", () => ({
  default: function MockCloudUsage() {
    return <div data-testid="cloud-usage">Cloud Usage</div>;
  },
}));
vi.mock("@/enterprise/components/Billing/OrbPortal", () => ({
  default: function MockOrbPortal() {
    return <div data-testid="orb-portal">Orb Portal</div>;
  },
}));

describe("UsagePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows access denied when user cannot view usage", () => {
    // @ts-expect-error partial mock
    vi.mocked(usePermissionsUtil).mockReturnValue({
      canViewUsage: () => false,
    });
    // @ts-expect-error partial mock
    vi.mocked(useUser).mockReturnValue({
      subscription: {},
    });

    render(<UsagePage />);

    expect(
      screen.getByText("You do not have access to view this page."),
    ).toBeInTheDocument();
  });

  it("shows Vercel billing info when subscription is managed by Vercel", () => {
    // @ts-expect-error partial mock
    vi.mocked(usePermissionsUtil).mockReturnValue({
      canViewUsage: () => true,
    });
    // @ts-expect-error partial mock
    vi.mocked(useUser).mockReturnValue({
      subscription: {
        isVercelIntegration: true,
      },
    });

    render(<UsagePage />);

    expect(
      screen.getByText(/plan is managed by Vercel/i),
    ).toBeInTheDocument();
  });

  it("renders CloudUsage for orb-billed subscriptions", () => {
    // @ts-expect-error partial mock
    vi.mocked(usePermissionsUtil).mockReturnValue({
      canViewUsage: () => true,
    });
    // @ts-expect-error partial mock
    vi.mocked(useUser).mockReturnValue({
      subscription: {
        billingPlatform: "orb",
      },
    });

    render(<UsagePage />);

    expect(screen.getByTestId("cloud-usage")).toBeInTheDocument();
    expect(screen.queryByTestId("orb-portal")).not.toBeInTheDocument();
  });
});
