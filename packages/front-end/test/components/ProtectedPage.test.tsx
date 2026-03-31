import { render, screen } from "@testing-library/react";
import React from "react";
import { vi } from "vitest";
import ProtectedPage from "@/components/ProtectedPage";

const mockUseFeatureIsOn = vi.fn(() => false);
const mockUseAuth = vi.fn(() => ({
  organizations: [],
  orgId: null as string | null,
  initialPlanSelection: "",
}));
const mockUseUser = vi.fn(() => ({
  error: "",
  ready: true,
  organization: {},
  effectiveAccountPlan: "",
}));

vi.mock("@growthbook/growthbook-react", () => ({
  useFeatureIsOn: () => mockUseFeatureIsOn(),
}));

vi.mock("@/services/auth", () => ({
  useAuth: () => mockUseAuth(),
  safeLogout: vi.fn(),
}));

vi.mock("@/services/UserContext", () => ({
  UserContextProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useUser: () => mockUseUser(),
}));

vi.mock("@/services/env", () => ({
  isCloud: () => false,
}));

vi.mock("@/services/WatchProvider", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/LoadingOverlay", () => ({
  default: () => <div data-testid="loading-overlay">Loading...</div>,
}));

vi.mock("@/components/Layout/TopNavLite", () => ({
  default: () => <div data-testid="top-nav-lite">TopNav</div>,
}));

vi.mock("@/components/Button", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("@/components/Auth/CreateOrJoinOrganization", () => ({
  default: () => <div>CreateOrJoinOrganization</div>,
}));

vi.mock("@/components/Auth/SelectInitialPlan", () => ({
  default: () => <div>SelectInitialPlan</div>,
}));

vi.mock("@/components/Auth/InAppHelp", () => ({
  default: () => null,
}));

describe("ProtectedPage error handling", () => {
  it("shows loading overlay for startup failed-to-fetch errors", () => {
    mockUseUser.mockReturnValue({
      error: "failed to fetch",
      ready: false,
      organization: {},
      effectiveAccountPlan: "",
    });
    mockUseAuth.mockReturnValue({
      organizations: [],
      orgId: "org_123",
      initialPlanSelection: "",
    });

    render(
      <ProtectedPage organizationRequired={true}>
        <div>child content</div>
      </ProtectedPage>,
    );

    expect(screen.getByTestId("loading-overlay")).toBeInTheDocument();
    expect(screen.queryByText("Error Signing In")).not.toBeInTheDocument();
  });

  it("shows API connection error when failed-to-fetch persists after ready", () => {
    mockUseUser.mockReturnValue({
      error: "failed to fetch",
      ready: true,
      organization: {},
      effectiveAccountPlan: "",
    });
    mockUseAuth.mockReturnValue({
      organizations: [],
      orgId: "org_123",
      initialPlanSelection: "",
    });

    render(
      <ProtectedPage organizationRequired={true}>
        <div>child content</div>
      </ProtectedPage>,
    );

    expect(screen.getByText("Connection Error")).toBeInTheDocument();
    expect(
      screen.getByText(/couldn'?t reach the growthbook api/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Error Signing In")).not.toBeInTheDocument();
  });

  it("still shows sign-in error for non-transient errors", () => {
    mockUseUser.mockReturnValue({
      error: "Organization not found",
      ready: true,
      organization: {},
      effectiveAccountPlan: "",
    });
    mockUseAuth.mockReturnValue({
      organizations: [],
      orgId: "org_123",
      initialPlanSelection: "",
    });

    render(
      <ProtectedPage organizationRequired={true}>
        <div>child content</div>
      </ProtectedPage>,
    );

    expect(screen.getByText("Error Signing In")).toBeInTheDocument();
    expect(screen.getByText("Organization not found")).toBeInTheDocument();
  });
});
