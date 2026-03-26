import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { describe, it, beforeEach, vi, expect } from "vitest";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import { useFeatureMetaInfo } from "@/hooks/useFeatureMetaInfo";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useBatchPrerequisiteStates } from "@/hooks/usePrerequisiteStates";
import { RadixTheme } from "@/services/RadixTheme";

vi.mock("shared/util", () => ({
  getDefaultPrerequisiteCondition: vi.fn(() => "{}"),
}));

vi.mock("shared/sdk-versioning", () => ({
  getConnectionsSDKCapabilities: vi.fn(() => []),
}));

vi.mock("@/services/features", () => ({
  condToJson: vi.fn(() => "{}"),
  jsonToConds: vi.fn(() => []),
}));

vi.mock("@/components/Marketing/PremiumTooltip", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/Features/ConditionInput", () => ({
  datatypeSupportsCaseInsensitive: vi.fn(() => false),
  getDisplayOperator: vi.fn(() => ""),
  isCaseInsensitiveOperator: vi.fn(() => false),
  operatorSupportsCaseInsensitive: vi.fn(() => false),
  withOperatorCaseInsensitivity: vi.fn((operator: string) => operator),
}));

vi.mock("@/hooks/useFeatureMetaInfo", () => ({
  useFeatureMetaInfo: vi.fn(),
}));

vi.mock("@/services/DefinitionsContext", () => ({
  useDefinitions: vi.fn(),
}));

vi.mock("@/services/UserContext", () => ({
  useUser: vi.fn(),
}));

vi.mock("@/hooks/useSDKConnections", () => ({
  default: vi.fn(),
}));

vi.mock("@/hooks/usePrerequisiteStates", () => ({
  useBatchPrerequisiteStates: vi.fn(),
}));

vi.mock("@/components/Features/PrerequisiteFeatureSelector", () => ({
  default: () => <div data-testid="prerequisite-feature-selector" />,
}));

vi.mock("@/components/Features/PrerequisiteStatesTable", () => ({
  __esModule: true,
  default: () => <div data-testid="prerequisite-states-table" />,
}));

vi.mock("@/components/Features/PrerequisiteAlerts", () => ({
  __esModule: true,
  default: () => <div data-testid="prerequisite-alerts" />,
}));

describe("PrerequisiteInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // @ts-expect-error partial test mock
    vi.mocked(useFeatureMetaInfo).mockReturnValue({
      features: [],
    });

    // @ts-expect-error partial test mock
    vi.mocked(useDefinitions).mockReturnValue({
      projects: [],
    });

    // @ts-expect-error partial test mock
    vi.mocked(useUser).mockReturnValue({
      hasCommercialFeature: () => true,
    });

    vi.mocked(useSDKConnections).mockReturnValue({
      data: {
        connections: [],
      },
    });

    vi.mocked(useBatchPrerequisiteStates).mockReturnValue([]);
  });

  it("renders the empty-state add action with bold text and adds a prerequisite", () => {
    const setValue = vi.fn();

    render(
      <RadixTheme>
        <TooltipProvider>
          <PrerequisiteInput
            value={[]}
            setValue={setValue}
            environments={[]}
            setPrerequisiteTargetingSdkIssues={vi.fn()}
          />
        </TooltipProvider>
      </RadixTheme>,
    );

    const addAction = screen.getByText("Add prerequisite targeting");
    expect(addAction).toBeInTheDocument();
    expect(addAction.tagName).toBe("SPAN");
    expect(addAction.parentElement?.querySelector("svg")).toBeTruthy();

    fireEvent.click(addAction);

    expect(setValue).toHaveBeenCalledWith([{ id: "", condition: "{}" }]);
  });
});
