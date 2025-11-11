import React from "react";
import { useRouter } from "next/router";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, beforeEach, vi, expect } from "vitest";
import ResultMoreMenu from "@/components/Experiment/ResultMoreMenu";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";

vi.mock("@/hooks/usePermissionsUtils");
vi.mock("@/services/experiments", () => ({
  getIsExperimentIncludedInIncrementalRefresh: vi.fn(),
}));
vi.mock("@/services/auth");
vi.mock("@/services/DefinitionsContext", () => ({
  useDefinitions: vi.fn(),
}));
vi.mock("next/router", () => ({
  useRouter: vi.fn(),
}));

describe("ResultMoreMenu", () => {
  const mockForceRefresh = vi.fn();
  const mockApiCall = vi.fn();
  const mockMutateDefinitions = vi.fn();
  const mockRouterPush = vi.fn();

  const defaultDatasource = {
    id: "ds-1",
    name: "Test Datasource",
    settings: {
      pipelineSettings: {
        mode: "incremental",
      },
    },
  };

  const defaultExperiment = {
    id: "exp-1",
    project: "proj-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useRouter).mockReturnValue({
      push: mockRouterPush,
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

    vi.mocked(useAuth).mockReturnValue({
      apiCall: mockApiCall,
    });

    vi.mocked(useDefinitions).mockReturnValue({
      mutateDefinitions: mockMutateDefinitions,
    });

    // Default permissions: user can run queries
    vi.mocked(usePermissionsUtil).mockReturnValue({
      canRunExperimentQueries: () => true,
      canUpdateDataSourceSettings: () => true,
      canCreateReport: () => false,
      canViewExperimentModal: () => false,
    });

    // Default: not included in incremental refresh
    vi.mocked(getIsExperimentIncludedInIncrementalRefresh).mockReturnValue(
      false,
    );
  });

  describe("Full Refresh / Re-run All Queries button", () => {
    it("shows 'Re-run All Queries' button for non-incremental refresh experiments", () => {
      vi.mocked(getIsExperimentIncludedInIncrementalRefresh).mockReturnValue(
        false,
      );

      render(
        <ResultMoreMenu
          experiment={defaultExperiment}
          datasource={defaultDatasource}
          forceRefresh={mockForceRefresh}
          notebookUrl="/notebook"
          notebookFilename="test"
        />,
      );

      const button = screen.getByText("Re-run All Queries");
      expect(button).toBeInTheDocument();
    });

    it("calls forceRefresh immediately when clicking 'Re-run All Queries' for non-incremental refresh", () => {
      vi.mocked(getIsExperimentIncludedInIncrementalRefresh).mockReturnValue(
        false,
      );

      render(
        <ResultMoreMenu
          experiment={defaultExperiment}
          datasource={defaultDatasource}
          forceRefresh={mockForceRefresh}
          notebookUrl="/notebook"
          notebookFilename="test"
        />,
      );

      const button = screen.getByText("Re-run All Queries");
      fireEvent.click(button);

      expect(mockForceRefresh).toHaveBeenCalledTimes(1);
    });

    it("shows 'Full Refresh' button for incremental refresh experiments without dimension", () => {
      vi.mocked(getIsExperimentIncludedInIncrementalRefresh).mockReturnValue(
        true,
      );

      render(
        <ResultMoreMenu
          experiment={defaultExperiment}
          datasource={defaultDatasource}
          forceRefresh={mockForceRefresh}
          notebookUrl="/notebook"
          notebookFilename="test"
        />,
      );

      const button = screen.getByText("Full Refresh");
      expect(button).toBeInTheDocument();
    });

    it("opens confirm dialog when clicking 'Full Refresh' for incremental refresh experiments", () => {
      vi.mocked(getIsExperimentIncludedInIncrementalRefresh).mockReturnValue(
        true,
      );

      render(
        <ResultMoreMenu
          experiment={defaultExperiment}
          datasource={defaultDatasource}
          forceRefresh={mockForceRefresh}
          notebookUrl="/notebook"
          notebookFilename="test"
        />,
      );

      // Get the button by role to avoid confusion with dialog title
      const buttons = screen.getAllByText("Full Refresh");
      const refreshButton = buttons.find(
        (btn) => btn.tagName === "BUTTON",
      ) as HTMLButtonElement;
      expect(refreshButton).toBeInTheDocument();
      fireEvent.click(refreshButton);

      // Confirm dialog should appear - check for dialog content
      expect(
        screen.getByText(/This experiment has Pipeline Mode enabled/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Fully refreshing the experiment will re-scan the data source/i,
        ),
      ).toBeInTheDocument();

      // forceRefresh should NOT be called yet
      expect(mockForceRefresh).not.toHaveBeenCalled();
    });

    it("calls forceRefresh when confirming Full Refresh dialog", () => {
      vi.mocked(getIsExperimentIncludedInIncrementalRefresh).mockReturnValue(
        true,
      );

      render(
        <ResultMoreMenu
          experiment={defaultExperiment}
          datasource={defaultDatasource}
          forceRefresh={mockForceRefresh}
          notebookUrl="/notebook"
          notebookFilename="test"
        />,
      );

      // Get the button by finding the button element
      const buttons = screen.getAllByText("Full Refresh");
      const refreshButton = buttons.find(
        (btn) => btn.tagName === "BUTTON",
      ) as HTMLButtonElement;
      fireEvent.click(refreshButton);

      // Click confirm button
      const confirmButton = screen.getByText("I understand");
      fireEvent.click(confirmButton);

      expect(mockForceRefresh).toHaveBeenCalledTimes(1);
    });

    it("hides button for incremental refresh experiments with dimension", () => {
      vi.mocked(getIsExperimentIncludedInIncrementalRefresh).mockReturnValue(
        true,
      );

      render(
        <ResultMoreMenu
          experiment={defaultExperiment}
          datasource={defaultDatasource}
          forceRefresh={mockForceRefresh}
          dimension="dimension-1"
          notebookUrl="/notebook"
          notebookFilename="test"
        />,
      );

      expect(screen.queryByText("Full Refresh")).not.toBeInTheDocument();
      expect(screen.queryByText("Re-run All Queries")).not.toBeInTheDocument();
    });

    it("hides button when user lacks permission to run queries", () => {
      vi.mocked(usePermissionsUtil).mockReturnValue({
        canRunExperimentQueries: () => false,
        canUpdateDataSourceSettings: () => true,
        canCreateReport: () => false,
        canViewExperimentModal: () => false,
      });

      render(
        <ResultMoreMenu
          experiment={defaultExperiment}
          datasource={defaultDatasource}
          forceRefresh={mockForceRefresh}
          notebookUrl="/notebook"
          notebookFilename="test"
        />,
      );

      expect(screen.queryByText("Re-run All Queries")).not.toBeInTheDocument();
      expect(screen.queryByText("Full Refresh")).not.toBeInTheDocument();
    });

    it("hides button when datasource is missing", () => {
      render(
        <ResultMoreMenu
          experiment={defaultExperiment}
          datasource={null}
          forceRefresh={mockForceRefresh}
          notebookUrl="/notebook"
          notebookFilename="test"
        />,
      );

      expect(screen.queryByText("Re-run All Queries")).not.toBeInTheDocument();
      expect(screen.queryByText("Full Refresh")).not.toBeInTheDocument();
    });

    it("hides button when forceRefresh is missing", () => {
      render(
        <ResultMoreMenu
          experiment={defaultExperiment}
          datasource={defaultDatasource}
          notebookUrl="/notebook"
          notebookFilename="test"
        />,
      );

      expect(screen.queryByText("Re-run All Queries")).not.toBeInTheDocument();
      expect(screen.queryByText("Full Refresh")).not.toBeInTheDocument();
    });
  });

  describe("Re-enable Incremental Refresh button", () => {
    it("shows 'Re-enable Incremental Refresh' button for excluded experiments with permission", () => {
      const excludedDatasource = {
        id: "ds-1",
        name: "Test Datasource",
        settings: {
          pipelineSettings: {
            mode: "incremental",
            excludedExperimentIds: ["exp-1"],
          },
        },
      };

      vi.mocked(getIsExperimentIncludedInIncrementalRefresh).mockReturnValue(
        false,
      );

      vi.mocked(usePermissionsUtil).mockReturnValue({
        canRunExperimentQueries: () => true,
        canUpdateDataSourceSettings: () => true,
        canCreateReport: () => false,
        canViewExperimentModal: () => false,
      });

      render(
        <ResultMoreMenu
          experiment={defaultExperiment}
          datasource={excludedDatasource}
          forceRefresh={mockForceRefresh}
          notebookUrl="/notebook"
          notebookFilename="test"
        />,
      );

      const button = screen.getByText("Re-enable Incremental Refresh");
      expect(button).toBeInTheDocument();
    });

    it("hides 'Re-enable Incremental Refresh' button when user lacks permission", () => {
      const excludedDatasource = {
        id: "ds-1",
        name: "Test Datasource",
        settings: {
          pipelineSettings: {
            mode: "incremental",
            excludedExperimentIds: ["exp-1"],
          },
        },
      };

      vi.mocked(getIsExperimentIncludedInIncrementalRefresh).mockReturnValue(
        false,
      );

      vi.mocked(usePermissionsUtil).mockReturnValue({
        canRunExperimentQueries: () => true,
        canUpdateDataSourceSettings: () => false,
        canCreateReport: () => false,
        canViewExperimentModal: () => false,
      });

      render(
        <ResultMoreMenu
          experiment={defaultExperiment}
          datasource={excludedDatasource}
          forceRefresh={mockForceRefresh}
          notebookUrl="/notebook"
          notebookFilename="test"
        />,
      );

      expect(
        screen.queryByText("Re-enable Incremental Refresh"),
      ).not.toBeInTheDocument();
    });

    it("hides 'Re-enable Incremental Refresh' button when experiment is not excluded", () => {
      vi.mocked(getIsExperimentIncludedInIncrementalRefresh).mockReturnValue(
        true,
      );

      render(
        <ResultMoreMenu
          experiment={defaultExperiment}
          datasource={defaultDatasource}
          forceRefresh={mockForceRefresh}
          notebookUrl="/notebook"
          notebookFilename="test"
        />,
      );

      expect(
        screen.queryByText("Re-enable Incremental Refresh"),
      ).not.toBeInTheDocument();
    });
  });
});
