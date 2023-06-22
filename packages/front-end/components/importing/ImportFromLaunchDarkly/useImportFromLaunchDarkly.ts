import { Reducer, useCallback, useEffect, useReducer, useState } from "react";
import { ProjectInterface } from "back-end/types/project";
import { Environment } from "back-end/types/organization";
import { FeatureInterface } from "back-end/types/feature";
import {
  getLDProjects,
  LDListEnvironmentsResponse,
  LDListFeatureFlagsResponse,
  LDListProjectsResponse,
  transformLDEnvironmentsToGBEnvironment,
  transformLDFeatureFlagToGBFeature,
  transformLDProjectsToGBProject,
} from "@/services/importing";
import { enqueueTasks, QueueTask, TaskResult } from "@/services/async-queue";
import { useAuth } from "@/services/auth";

/**
 * User-friendly result message with status
 */
export type LDOperationResult = {
  status: "completed" | "failed";
  message: string;
};

export type ImportTaskResults = {
  projects: {
    taskResults: LDOperationResult[];
    totalProjects: number;
    remainingProjects: number;
  };
};

export type UseImportFromLaunchDarkly = {
  performImport: (apiToken: string) => Promise<void>;
  errors: string[];
  results: ImportTaskResults;
  pending: boolean;
};

type LDReducerState = {
  // LD resources
  /**
   * a list of project names that were downloaded from LD
   */
  downloadedProjects: string[];

  /**
   * a list of environment names that were downloaded from LD
   */
  downloadedEnvironments: string[];

  /**
   * a list of feature keys that were downloaded from LD
   */
  downloadedFeatureFlags: string[];

  /**
   * raw response from LD for List Environments
   */
  ldEnvironmentsResponse: LDListEnvironmentsResponse | null;

  /**
   * raw response from LD for List Projects
   */
  ldProjectsResponse: LDListProjectsResponse | null;

  /**
   * raw response from LD for List Feature Flags
   */
  ldFeatureFlagsResponse: LDListFeatureFlagsResponse | null;

  // GB resources

  /**
   * the projects that we plan to create
   */
  gbProjects: Pick<ProjectInterface, "name" | "description">[];

  /**
   * the list of projects that have been successfully created in GrowthBook
   */
  gbProjectsCreated: ProjectInterface[];

  /**
   * the features we plan on creating
   */
  gbFeatures: Omit<
    FeatureInterface,
    "dateCreated" | "dateUpdated" | "revision" | "organization"
  >[];

  /**
   * the environments we plan on creating
   */
  gbEnvironments: Environment[];

  /**
   * when projects are ready, we can create the dependent resources
   */
  projectsReady: boolean;

  /**
   * general errors
   */
  errors: string[];

  /**
   * some UI-friendly results
   */
  importProjectsResults: LDOperationResult[];
};

type AddErrorAction = {
  type: "add-error";
  data: string;
};

type AddGBImportedProject = {
  type: "add-gb-imported-project";
  data: ProjectInterface;
};

type AddImportResult = {
  type: "add-import-result";
  data: LDOperationResult;
};

type SetLDProjectsResponse = {
  type: "set-ld-projects";
  data: LDListProjectsResponse;
};

type SetLDEnvironmentsResponse = {
  type: "set-ld-environments";
  projectId: string;
  data: LDListEnvironmentsResponse;
};

type SetLDFeatureFlagsResponse = {
  type: "set-ld-feature-flags";
  projectId: string;
  data: LDListFeatureFlagsResponse;
};

type SetGBProjectsReady = {
  type: "set-gb-projects-ready";
};

type LDReducerAction =
  | AddErrorAction
  | AddGBImportedProject
  | SetLDProjectsResponse
  | SetLDEnvironmentsResponse
  | SetLDFeatureFlagsResponse
  | SetGBProjectsReady
  | AddImportResult;

const handleSetLDProjects: Reducer<LDReducerState, SetLDProjectsResponse> = (
  state,
  action
) => {
  const gbProjects = transformLDProjectsToGBProject(action.data);
  const projectNames = gbProjects.map((p) => p.name);

  return {
    ...state,
    ldProjectsResponse: action.data,
    gbProjects,
    downloadedProjects: projectNames,
  };
};

const handleSetLDEnvironments: Reducer<
  LDReducerState,
  SetLDEnvironmentsResponse
> = (state, action) => {
  const gbEnvironments = transformLDEnvironmentsToGBEnvironment(action.data);
  const envNames = gbEnvironments.map((env) => env.id);

  return {
    ...state,
    ldEnvironmentsResponse: action.data,
    gbEnvironments,
    downloadedEnvironments: envNames,
  };
};

const handleSetLDFeatureFlags: Reducer<
  LDReducerState,
  SetLDFeatureFlagsResponse
> = (state, action) => {
  const gbFeatures = transformLDFeatureFlagToGBFeature(
    action.data,
    action.projectId
  );

  return {
    ...state,
    ldFeatureFlagsResponse: action.data,
    gbFeatures,
  };
};

const importFromLDReducer: Reducer<LDReducerState, LDReducerAction> = (
  state,
  action
) => {
  // console.log(">>>> State", state);
  switch (action.type) {
    case "set-gb-projects-ready":
      return {
        ...state,
        projectsReady: true,
      };

    case "add-import-result":
      return {
        ...state,
        importProjectsResults: [...state.importProjectsResults, action.data],
      };

    case "set-ld-projects":
      return handleSetLDProjects(state, action);

    case "set-ld-environments":
      return handleSetLDEnvironments(state, action);

    case "set-ld-feature-flags":
      return handleSetLDFeatureFlags(state, action);

    case "add-error":
      return {
        ...state,
        errors: [...state.errors, action.data],
      };

    case "add-gb-imported-project":
      return {
        ...state,
        gbProjectsCreated: [...state.gbProjectsCreated, action.data],
      };

    default:
      return state;
  }
};

const initialState: LDReducerState = {
  importProjectsResults: [],
  projectsReady: false,
  errors: [],
  downloadedProjects: [],
  downloadedEnvironments: [],
  downloadedFeatureFlags: [],
  ldProjectsResponse: null,
  ldEnvironmentsResponse: null,
  ldFeatureFlagsResponse: null,
  gbProjects: [],
  gbProjectsCreated: [],
  gbEnvironments: [],
  gbFeatures: [],
};

export const useImportFromLaunchDarkly = (): UseImportFromLaunchDarkly => {
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [state, dispatch] = useReducer(importFromLDReducer, initialState);

  const { apiCall } = useAuth();

  /**
   * Kicks off the process for fetching LD data and import tasks.
   * Projects are a dependency to environments and feature flags, so these need to be downloaded first.
   * Then, once we have projects, we can fetch dependent feature flags and environments.
   */
  const performImport = useCallback(
    async (apiToken: string): Promise<void> => {
      setApiToken(apiToken);

      try {
        const ldProjects = await getLDProjects(apiToken);

        dispatch({
          type: "set-ld-projects",
          data: ldProjects,
        });
      } catch (e) {
        dispatch({
          type: "add-error",
          data: e.message || "Failed to fetch projects from LaunchDarkly",
        });
      }
    },
    [dispatch]
  );

  useEffect(
    /**
     * only once the projects are created in GrowthBook can we start to create the dependent resources in GrowthBook
     */
    function onGBProjectsCreated() {
      if (!state.projectsReady) {
        return;
      }

      // todo:
      console.log(
        "todo: time to create other things from the created projects",
        state.gbProjectsCreated
      );
    },
    [state.projectsReady, state.gbProjectsCreated]
  );

  useEffect(
    function fetchLDResourcesForProjects() {
      if (!state.gbProjects.length) {
        return;
      }

      const perform = async () => {
        if (!apiToken) {
          console.warn("cannot fetch LD resources without API token");
          return;
        }

        if (!state.gbProjects.length) {
          return;
        }

        setPending(true);

        const createProjectTasks: QueueTask<
          Pick<ProjectInterface, "name" | "description">
        >[] = state.gbProjects.map((p) => ({
          id: p.name,
          data: p,
        }));

        // const { failed, completed } = await enqueueTasks<
        await enqueueTasks<
          Pick<ProjectInterface, "name" | "description">,
          ProjectInterface
        >(createProjectTasks, {
          onProgress(id, result): void {
            switch (result.status) {
              case "success":
                dispatch({
                  type: "add-gb-imported-project",
                  data: result.data,
                });
                dispatch({
                  type: "add-import-result",
                  data: {
                    status: "completed",
                    message: `Imported project ${id} as ${result.data.name} (${result.data.id})`,
                  },
                });
                break;

              case "retry":
              case "fail":
                dispatch({
                  type: "add-import-result",
                  data: {
                    status: "failed",
                    message: `Failed to import project ${id} with error: ${result.error}`,
                  },
                });
                break;
            }
          },
          async perform(data): Promise<TaskResult<ProjectInterface>> {
            try {
              const response = await apiCall<{
                project?: ProjectInterface;
                message?: string;
              }>("/projects", {
                method: "POST",
                body: JSON.stringify(data),
              });

              if (!response.project) {
                return {
                  status: "fail",
                  error: response.message || "unknown error",
                };
              }

              return {
                status: "success",
                data: response.project,
              };
            } catch (e) {
              return {
                status: "fail",
                error: e.message || "unknown error",
              };
            }
          },
        });

        // Tasks are done. Time to perform tasks that depend on the GB projects
        dispatch({ type: "set-gb-projects-ready" });
        setPending(false);
      };

      perform();
    },
    [state.gbProjects, apiToken, apiCall]
  );

  const totalProjects = state.gbProjects.length;
  const remainingProjects =
    state.gbProjects.length - state.importProjectsResults.length;

  return {
    pending,
    performImport,
    errors: state.errors,
    results: {
      projects: {
        taskResults: state.importProjectsResults,
        totalProjects,
        remainingProjects,
      },
    },
  };
};
