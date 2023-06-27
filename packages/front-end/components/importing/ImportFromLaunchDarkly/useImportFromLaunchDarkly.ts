import { Reducer, useCallback, useEffect, useReducer, useState } from "react";
import { ProjectInterface } from "back-end/types/project";
import { Environment } from "back-end/types/organization";
import { FeatureInterface } from "back-end/types/feature";
import {
  getLDEnvironments,
  getLDFeatureFlags,
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
  };
  environments: {
    taskResults: LDOperationResult[];
  };
  features: {
    taskResults: LDOperationResult[];
  };
};

export type UseImportFromLaunchDarkly = {
  performImport: (apiToken: string) => Promise<void>;
  errors: string[];
  results: ImportTaskResults;
  status: "idle" | "pending" | "completed";
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
   * the features that we created
   */
  gbFeaturesCreated: FeatureInterface[];

  /**
   * the environments we plan on creating
   */
  gbEnvironments: Environment[];

  /**
   * environments that have been successfully created in GrowthBook
   */
  gbEnvironmentsCreated: Environment[];

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
  importEnvironmentsResults: LDOperationResult[];
  importFeaturesResults: LDOperationResult[];
};

type AddErrorAction = {
  type: "add-error";
  data: string;
};

type AddGBImportedProject = {
  type: "add-gb-imported-project";
  data: ProjectInterface;
};

type AddGBCreatedEnvironment = {
  type: "add-gb-created-environment";
  data: Environment;
};

type AddGBCreatedFeature = {
  type: "add-gb-created-feature";
  data: FeatureInterface;
};

type AddImportProjectResult = {
  type: "add-import-project-result";
  data: LDOperationResult;
};

type AddImportFeatureResult = {
  type: "add-import-feature-result";
  data: LDOperationResult;
};

type AddImportEnvironmentResult = {
  type: "add-import-environment-result";
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
  | AddImportProjectResult
  | AddGBCreatedEnvironment
  | AddGBCreatedFeature
  | AddImportEnvironmentResult
  | AddImportFeatureResult;

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
  switch (action.type) {
    case "add-gb-created-feature":
      return {
        ...state,
        gbFeaturesCreated: [...state.gbFeaturesCreated, action.data],
      };

    case "add-gb-created-environment":
      return {
        ...state,
        gbEnvironmentsCreated: [...state.gbEnvironmentsCreated, action.data],
      };

    case "set-gb-projects-ready":
      return {
        ...state,
        projectsReady: true,
      };

    case "add-import-project-result":
      return {
        ...state,
        importProjectsResults: [...state.importProjectsResults, action.data],
      };

    case "add-import-environment-result":
      return {
        ...state,
        importEnvironmentsResults: [
          ...state.importEnvironmentsResults,
          action.data,
        ],
      };

    case "add-import-feature-result":
      return {
        ...state,
        importFeaturesResults: [...state.importFeaturesResults, action.data],
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
  importProjectsResults: [], // todo: add & use
  importFeaturesResults: [], // todo: add & use
  importEnvironmentsResults: [], // todo: add & use
  projectsReady: false,
  errors: [],
  downloadedProjects: [], // todo: use or delete
  downloadedEnvironments: [], // todo: add & use
  downloadedFeatureFlags: [], // todo: add & use
  ldProjectsResponse: null,
  ldEnvironmentsResponse: null,
  ldFeatureFlagsResponse: null,
  gbProjects: [],
  gbProjectsCreated: [],
  gbEnvironments: [],
  gbEnvironmentsCreated: [],
  gbFeatures: [],
  gbFeaturesCreated: [], // todo: add & use
};

export const useImportFromLaunchDarkly = (): UseImportFromLaunchDarkly => {
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "completed">(
    "idle"
  );

  const [state, dispatch] = useReducer(importFromLDReducer, initialState);

  const { apiCall } = useAuth();

  /**
   * Kicks off the process for fetching LD data and import tasks.
   * Projects are a dependency to environments and feature flags, so these need to be downloaded first.
   * Then, once we have projects, we can fetch dependent feature flags and environments.
   */
  const performImport = useCallback(
    async (apiToken: string): Promise<void> => {
      if (status === "completed") return;

      setStatus("pending");
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
        setStatus("completed");
      }
    },
    [dispatch, status]
  );

  useEffect(
    /**
     * only once the projects are created in GrowthBook can we start to create the dependent resources in GrowthBook
     */
    function onGBProjectsCreated() {
      if (status === "completed") return;
      if (!state.projectsReady) {
        return;
      }

      const createEnvironments = async () => {
        if (!apiToken) {
          console.warn("cannot fetch LD resources without API token");
          return;
        }

        const environmentsToCreate = new Map<string, Environment>();

        // Enqueue fetching of LD Environments and creation of GB Environments
        for (const project of state.gbProjectsCreated) {
          try {
            const ldProjectEnvironments = await getLDEnvironments(
              apiToken,
              project.name
            );
            const gbEnvironments = transformLDEnvironmentsToGBEnvironment(
              ldProjectEnvironments
            );

            for (const e of gbEnvironments) {
              environmentsToCreate.set(e.id, {
                ...e,
                toggleOnList: false,
                defaultState: true,
              });
            }

            dispatch({
              type: "add-import-environment-result",
              data: {
                status: "completed",
                message: `Fetched environments for project ${project.name} from LaunchDarkly`,
              },
            });
          } catch (e) {
            dispatch({
              type: "add-import-environment-result",
              data: {
                status: "failed",
                message: `Failed to fetch environments for project ${
                  project.name
                }: ${e.message || "unknown error"}`,
              },
            });
          }

          await wait(500);
        }

        // Enqueue each environment creation individually
        const createEnvironmentTasks: QueueTask<Environment>[] = [];
        environmentsToCreate.forEach((env, id) => {
          createEnvironmentTasks.push({
            id,
            data: env,
          });
        });

        await enqueueTasks<Environment, Environment>(
          createEnvironmentTasks,
          {
            onProgress(id, result) {
              switch (result.status) {
                case "success":
                  dispatch({
                    type: "add-gb-created-environment",
                    data: result.data,
                  });
                  dispatch({
                    type: "add-import-environment-result",
                    data: {
                      status: "completed",
                      message: `Imported environment ${id}`,
                    },
                  });
                  break;

                case "retry":
                case "fail":
                  dispatch({
                    type: "add-import-environment-result",
                    data: {
                      status: "failed",
                      message: `Failed to import environment ${id} with error: ${result.error}`,
                    },
                  });
                  break;
              }
            },
            async perform(data: Environment): Promise<TaskResult<Environment>> {
              try {
                const response = await apiCall<{
                  status: number;
                  message?: string;
                }>("/environment", {
                  method: "POST",
                  body: JSON.stringify({
                    environment: data,
                  }),
                });

                if (response.status !== 200) {
                  return {
                    status: "fail",
                    error: response.message || "unknown error",
                  };
                }

                return {
                  status: "success",
                  data,
                };
              } catch (e) {
                return {
                  status: "fail",
                  error: e.message || "unknown error",
                };
              }
            },
          },
          {
            delayMs: 2000,
          }
        );
      };

      const createFeatures = async () => {
        if (!apiToken) {
          console.warn("cannot fetch LD resources without API token");
          return;
        }

        const featuresToCreate = new Map<
          string,
          Omit<
            FeatureInterface,
            "dateCreated" | "dateUpdated" | "revision" | "organization"
          >
        >();

        for (const project of state.gbProjectsCreated) {
          try {
            const ldProjectFeatureFlags = await getLDFeatureFlags(
              apiToken,
              project.name
            );
            const gbFeatures = transformLDFeatureFlagToGBFeature(
              ldProjectFeatureFlags,
              project.id
            );

            for (const f of gbFeatures) {
              featuresToCreate.set(f.id, f);
            }

            dispatch({
              type: "add-import-feature-result",
              data: {
                status: "completed",
                message: `Fetched features for project ${project.name} from LaunchDarkly`,
              },
            });
          } catch (e) {
            dispatch({
              type: "add-import-feature-result",
              data: {
                status: "failed",
                message: `Failed to fetch features for project ${
                  project.name
                }: ${e.message || "unknown error"}`,
              },
            });
          }

          await wait(500);
        }

        const createFeatureTasks: QueueTask<
          Omit<
            FeatureInterface,
            "dateCreated" | "dateUpdated" | "revision" | "organization"
          >
        >[] = [];
        featuresToCreate.forEach((feature, id) => {
          createFeatureTasks.push({
            id,
            data: feature,
          });
        });

        await enqueueTasks<
          Omit<
            FeatureInterface,
            "dateCreated" | "dateUpdated" | "revision" | "organization"
          >,
          FeatureInterface
        >(createFeatureTasks, {
          onProgress(id, result) {
            switch (result.status) {
              case "success":
                // TODO: delete?
                // dispatch({
                //   type: "add-gb-created-feature",
                //   data: result.data,
                // });
                dispatch({
                  type: "add-import-feature-result",
                  data: {
                    status: "completed",
                    message: `Successfully imported feature ${id}`,
                  },
                });
                break;

              case "fail":
              case "retry":
                dispatch({
                  type: "add-import-feature-result",
                  data: {
                    status: "failed",
                    message: `Failed to import feature ${id} with error: ${result.error}`,
                  },
                });
                break;
            }
          },
          async perform(
            data: Omit<
              FeatureInterface,
              "dateCreated" | "dateUpdated" | "revision" | "organization"
            >
          ): Promise<TaskResult<FeatureInterface>> {
            try {
              const response = await apiCall<{
                status: number;
                message?: string;
                feature: FeatureInterface;
              }>("/feature", {
                method: "POST",
                body: JSON.stringify(data),
              });

              if (response.status !== 200) {
                return {
                  status: "fail",
                  error: response.message || "unknown error",
                };
              }

              return {
                status: "success",
                data: response.feature,
              };
            } catch (e) {
              return {
                status: "fail",
                error: e.message || "unknown error",
              };
            }
          },
        });
      };

      const createAll = async () => {
        await createEnvironments();
        await createFeatures();

        setStatus("completed");
      };

      createAll();
    },
    [
      apiToken,
      state.projectsReady,
      state.gbProjectsCreated,
      state.gbEnvironments,
      apiCall,
    ]
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
                  type: "add-import-project-result",
                  data: {
                    status: "completed",
                    message: `Imported project ${id} as ${result.data.name} (${result.data.id})`,
                  },
                });
                break;

              case "retry":
              case "fail":
                dispatch({
                  type: "add-import-project-result",
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
      };

      perform();
    },
    [state.gbProjects, apiToken, apiCall]
  );

  return {
    status,
    performImport,
    errors: state.errors,
    results: {
      projects: {
        taskResults: state.importProjectsResults,
      },
      environments: {
        taskResults: state.importEnvironmentsResults,
      },
      features: {
        taskResults: state.importFeaturesResults,
      },
    },
  };
};

function wait(timeMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, timeMs);
  });
}
