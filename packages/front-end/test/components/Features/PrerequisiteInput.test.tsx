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
    expect(addAction).toHaveAttribute("data-accent-color", "gray");
    expect(addAction.tagName).toBe("SPAN");

    fireEvent.click(addAction);

    expect(setValue).toHaveBeenCalledWith([{ id: "", condition: "{}" }]);
  });
});
