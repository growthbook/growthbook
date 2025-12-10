import React from "react";
import { useRouter } from "next/router";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, beforeEach, vi, expect } from "vitest";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
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
  } as DataSourceInterfaceWithParams;

  const defaultExperiment = {
    id: "exp-1",
    project: "proj-1",
  } as ExperimentInterfaceStringDates;

  beforeEach(() => {
    vi.clearAllMocks();

    // @ts-expect-error - partial mock
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

    // @ts-expect-error - partial mock
    vi.mocked(useAuth).mockReturnValue({
      apiCall: mockApiCall,
    });

    // @ts-expect-error - partial mock
    vi.mocked(useDefinitions).mockReturnValue({
      mutateDefinitions: mockMutateDefinitions,
    });

    // @ts-expect-error - partial mock
    vi.mocked(usePermissionsUtil).mockReturnValue({
      canRunExperimentQueries: () => true,
      canUpdateDataSourceSettings: () => true,
      canCreateReport: () => false,
      canViewExperimentModal: () => false,
    });

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

      expect(
        screen.getByText(/This experiment has Pipeline Mode enabled/i),
      ).toBeInTheDocument();

      // forceRefresh should NOT be called yet
      expect(mockForceRefresh).not.toHaveBeenCalled();

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
      // @ts-expect-error - partial mock
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
      const datasourceWithExcludedExperiment = {
        id: "ds-1",
        name: "Test Datasource",
        settings: {
          pipelineSettings: {
            mode: "incremental",
            excludedExperimentIds: ["exp-1"],
          },
        },
      } as DataSourceInterfaceWithParams;

      vi.mocked(getIsExperimentIncludedInIncrementalRefresh).mockReturnValue(
        false,
      );

      // @ts-expect-error - partial mock
      vi.mocked(usePermissionsUtil).mockReturnValue({
        canRunExperimentQueries: () => true,
        canUpdateDataSourceSettings: () => true,
        canCreateReport: () => false,
        canViewExperimentModal: () => false,
      });

      render(
        <ResultMoreMenu
          experiment={defaultExperiment}
          datasource={datasourceWithExcludedExperiment}
          forceRefresh={mockForceRefresh}
          notebookUrl="/notebook"
          notebookFilename="test"
        />,
      );

      const button = screen.getByText("Re-enable Incremental Refresh");
      expect(button).toBeInTheDocument();
    });

    it("hides 'Re-enable Incremental Refresh' button when user lacks permission", () => {
      const datasourceWithExcludedExperiment = {
        id: "ds-1",
        name: "Test Datasource",
        settings: {
          pipelineSettings: {
            mode: "incremental",
            excludedExperimentIds: ["exp-1"],
          },
        },
      } as DataSourceInterfaceWithParams;

      vi.mocked(getIsExperimentIncludedInIncrementalRefresh).mockReturnValue(
        false,
      );

      // @ts-expect-error - partial mock
      vi.mocked(usePermissionsUtil).mockReturnValue({
        canRunExperimentQueries: () => true,
        canUpdateDataSourceSettings: () => false,
        canCreateReport: () => false,
        canViewExperimentModal: () => false,
      });

      render(
        <ResultMoreMenu
          experiment={defaultExperiment}
          datasource={datasourceWithExcludedExperiment}
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
