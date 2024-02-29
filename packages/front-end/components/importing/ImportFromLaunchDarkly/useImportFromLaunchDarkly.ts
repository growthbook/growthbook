import {
  Reducer,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
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
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";

/**
 * User-friendly result message with status
 */
export type LDOperationResult = {
  status: "completed" | "failed" | "ignored";
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
    "dateCreated" | "dateUpdated" | "version" | "organization"
  >[];

  /**
   * the environments we plan on creating
   */
  gbEnvironments: Environment[];

  /**
   * environments that have been successfully created in GrowthBook
   */
  gbEnvironmentsCreated: Environment[];

  // State and results

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

type SetGBProjectsReady = {
  type: "set-gb-projects-ready";
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

type LDReducerAction =
  | SetLDProjectsResponse
  | SetLDEnvironmentsResponse
  | SetLDFeatureFlagsResponse
  | SetGBProjectsReady
  | AddGBImportedProject
  | AddErrorAction
  | AddImportProjectResult
  | AddImportEnvironmentResult
  | AddImportFeatureResult;

const importFromLDReducer: Reducer<LDReducerState, LDReducerAction> = (
  state,
  action
) => {
  switch (action.type) {
    case "set-ld-projects":
      return {
        ...state,
        ldProjectsResponse: action.data,
        gbProjects: transformLDProjectsToGBProject(action.data),
      };

    case "set-ld-environments":
      return {
        ...state,
        ldEnvironmentsResponse: action.data,
        gbEnvironments: transformLDEnvironmentsToGBEnvironment(action.data),
      };

    case "set-ld-feature-flags":
      return {
        ...state,
        ldFeatureFlagsResponse: action.data,
        gbFeatures: transformLDFeatureFlagToGBFeature(
          action.data,
          action.projectId
        ),
      };

    case "add-gb-imported-project":
      return {
        ...state,
        gbProjectsCreated: [...state.gbProjectsCreated, action.data],
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

    case "add-error":
      return {
        ...state,
        errors: [...state.errors, action.data],
      };

    default:
      return state;
  }
};

const initialState: LDReducerState = {
  importProjectsResults: [],
  importFeaturesResults: [],
  importEnvironmentsResults: [],
  projectsReady: false,
  errors: [],
  ldProjectsResponse: null,
  ldEnvironmentsResponse: null,
  ldFeatureFlagsResponse: null,
  gbProjects: [],
  gbProjectsCreated: [],
  gbEnvironments: [],
  gbEnvironmentsCreated: [],
  gbFeatures: [],
};

export const useImportFromLaunchDarkly = (): UseImportFromLaunchDarkly => {
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "completed">(
    "idle"
  );

  const { projects } = useDefinitions();
  const existingProjectNames = useMemo(
    () => (projects || []).map((project) => (project.name || "").toLowerCase()),
    [projects]
  );

  const [state, dispatch] = useReducer(importFromLDReducer, initialState);

  const { apiCall } = useAuth();

  useEffect(function trackPageVisit() {
    track("Import from Service visit", {
      service: "launchdarkly",
    });
  }, []);

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
        track("Import from Service failed", {
          service: "launchdarkly",
          error: e.message || "Unknown Error",
        });
      }
    },
    [dispatch, status]
  );

  useEffect(
    /**
     * only once the projects are created in GrowthBook can we start to create the dependent resources in GrowthBook
     */
    function onGBProjectsCreated() {
      console.log("projectsCreated deps", [
        apiToken,
        state.projectsReady,
        state.gbProjectsCreated,
        state.gbEnvironments,
        apiCall,
        status,
      ])
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

        const {
          completed: completedEnvs,
          failed: failedEnvs,
        } = await enqueueTasks<Environment, Environment>(
          createEnvironmentTasks,
          {
            onProgress(id, result) {
              switch (result.status) {
                case "success":
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
                  if (result.error === "duplicate") {
                    dispatch({
                      type: "add-import-environment-result",
                      data: {
                        status: "ignored",
                        message: `Environment ${id} already exists and was not imported.`,
                      },
                    });
                  } else {
                    dispatch({
                      type: "add-import-environment-result",
                      data: {
                        status: "failed",
                        message: `Failed to import environment ${id} with error: ${result.error}`,
                      },
                    });
                  }
                  break;
              }
            },
            async perform(data: Environment): Promise<TaskResult<Environment>> {
              try {
                const response = await apiCall<{
                  status: number;
                  message?: string;
                }>("/environmentxxx", {
                  method: "POST",
                  body: JSON.stringify({
                    environment: data,
                  }),
                });

                if (response.status == 200) {
                  return {
                    status: "success",
                    data,
                  };
                }

                if (response.message?.includes("already exists")) {
                  return {
                    status: "fail",
                    error: "duplicate",
                  };
                }
                return {
                  status: "fail",
                  error: response.message || "unknown error",
                };
              } catch (e) {
                if (e.message?.includes("already exists")) {
                  return {
                    status: "fail",
                    error: "duplicate",
                  };
                }
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

        track("Import from Service success", {
          service: "launchdarkly",
          resource: "environment",
          successCount: completedEnvs.length,
          skippedCount: failedEnvs.filter((t) => t.result.status === "fail")
            .length,
          failedCount: failedEnvs.filter((t) => t.result.status === "retry")
            .length,
        });
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
            "dateCreated" | "dateUpdated" | "organization" | "version"
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
            "dateCreated" | "dateUpdated" | "organization" | "version"
          >
        >[] = [];
        featuresToCreate.forEach((feature, id) => {
          createFeatureTasks.push({
            id,
            data: feature,
          });
        });

        const {
          completed: completedFeatures,
          failed: failedFeatures,
        } = await enqueueTasks<
          Omit<
            FeatureInterface,
            "dateCreated" | "dateUpdated" | "version" | "organization"
          >,
          FeatureInterface
        >(createFeatureTasks, {
          onProgress(id, result) {
            switch (result.status) {
              case "success":
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
                if (result.error === "duplicate") {
                  dispatch({
                    type: "add-import-feature-result",
                    data: {
                      status: "ignored",
                      message: `Feature ${id} already exists and was not imported`,
                    },
                  });
                } else {
                  dispatch({
                    type: "add-import-feature-result",
                    data: {
                      status: "failed",
                      message: `Failed to import feature ${id} with error: ${result.error}`,
                    },
                  });
                }
                break;
            }
          },
          async perform(
            data: Omit<
              FeatureInterface,
              "dateCreated" | "dateUpdated" | "version" | "organization"
            >
          ): Promise<TaskResult<FeatureInterface>> {
            try {
              const response = await apiCall<{
                status: number;
                message?: string;
                feature: FeatureInterface;
              }>("/featurexxx", {
                method: "POST",
                body: JSON.stringify(data),
              });

              if (response.status == 200) {
                return {
                  status: "success",
                  data: response.feature,
                };
              }

              if (response.message?.includes("already exists")) {
                return {
                  status: "fail",
                  error: "duplicate",
                };
              }
              return {
                status: "fail",
                error: response.message || "unknown error",
              };
            } catch (e) {
              if (e.message?.includes("already exists")) {
                return {
                  status: "fail",
                  error: "duplicate",
                };
              }
              return {
                status: "fail",
                error: e.message || "unknown error",
              };
            }
          },
        });

        track("Import from Service success", {
          service: "launchdarkly",
          resource: "feature",
          successCount: completedFeatures.length,
          skippedCount: failedFeatures.filter((t) => t.result.status === "fail")
            .length,
          failedCount: failedFeatures.filter((t) => t.result.status === "retry")
            .length,
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
      status,
    ]
  );

  useEffect(
    /**
     * This runs once the projects are downloaded from LD and created in GrowthBook.
     * Projects are a hard dependency of remaining resources in LD and
     * without them we cannot proceed.
     */
    function fetchLDResourcesForProjects() {
      if (!state.gbProjects.length) {
        return;
      }
      if (!apiToken) {
        console.warn("cannot fetch LD resources without API token");
        return;
      }

      const perform = async () => {
        const createProjectTasks: QueueTask<
          Pick<ProjectInterface, "name" | "description">
        >[] = state.gbProjects.map((p) => ({
          id: p.name,
          data: p,
        }));

        const {
          completed: projectsCompleted,
          failed: projectsFailed,
        } = await enqueueTasks<
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
                if (result.error === "duplicate") {
                  dispatch({
                    type: "add-import-project-result",
                    data: {
                      status: "ignored",
                      message: `Project ${id} already exists and was not imported`,
                    },
                  });
                } else {
                  dispatch({
                    type: "add-import-project-result",
                    data: {
                      status: "failed",
                      message: `Failed to import project ${id} with error: ${result.error}`,
                    },
                  });
                }
                break;
            }
          },
          async perform(data): Promise<TaskResult<ProjectInterface>> {
            if (existingProjectNames.includes(data.name.toLowerCase())) {
              return {
                status: "fail",
                error: "duplicate",
              };
            }

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

        dispatch({ type: "set-gb-projects-ready" });

        track("Import from Service success", {
          service: "launchdarkly",
          resource: "project",
          successCount: projectsCompleted.length,
          skippedCount: projectsFailed.filter((t) => t.result.status === "fail")
            .length,
          failedCount: projectsFailed.filter((t) => t.result.status === "retry")
            .length,
        });
      };

      perform();
    },
    [state.gbProjects, apiToken, apiCall, existingProjectNames]
  );

  useEffect(() => {
    console.log("state", state)

  }, [state])

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
