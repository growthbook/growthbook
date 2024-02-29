import React, { useMemo, useState } from "react";
import { ProjectInterface } from "back-end/types/project";
import PQueue from "p-queue";
import { FeatureInterface } from "back-end/types/feature";
import { FaTriangleExclamation } from "react-icons/fa6";
import { FaCheck, FaMinusCircle, FaPlus } from "react-icons/fa";
import { MdPending } from "react-icons/md";
import { cloneDeep } from "lodash";
import {
  FeatureVariationsMap,
  getLDEnvironments,
  getLDFeatureFlags,
  getLDProjects,
  getTypeAndVariations,
  transformLDFeatureFlag,
  transformLDProjectsToGBProject,
} from "@/services/importing";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import Code from "@/components/SyntaxHighlighting/Code";
import LoadingOverlay from "@/components/LoadingOverlay";
import Modal from "@/components/Modal";
import Button from "@/components/Button";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { ApiCallType, useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import { useUser } from "@/services/UserContext";

type ImportStatus = "invalid" | "skipped" | "pending" | "completed" | "failed";

interface FeatureImport {
  key: string;
  status: ImportStatus;
  feature?: Omit<
    FeatureInterface,
    "organization" | "dateCreated" | "dateUpdated" | "version"
  >;
  error?: string;
}

interface ProjectImport {
  key: string;
  status: ImportStatus;
  project?: Pick<ProjectInterface, "id" | "name" | "description">;
  error?: string;
}

interface EnvironmentImport {
  key: string;
  status: ImportStatus;
  env?: {
    id: string;
    description: string;
    projects: string[];
  };
  error?: string;
}

interface ImportData {
  status: "init" | "loading" | "error" | "ready" | "importing" | "completed";
  projects?: ProjectImport[];
  envs?: EnvironmentImport[];
  features?: FeatureImport[];
  error?: string;
}

async function buildImportedData(
  apiToken: string,
  existingProjects: Map<string, ProjectInterface>,
  existingEnvs: Set<string>
): Promise<ImportData> {
  // Get projects
  const ldProjects = await getLDProjects(apiToken);
  const projects: ProjectImport[] = transformLDProjectsToGBProject(
    ldProjects
  ).map((p) => {
    const existing = existingProjects.get(p.name);
    if (existing) {
      return {
        key: p.id,
        status: "skipped",
        project: existing,
        error: "Project already exists",
      };
    }

    return {
      key: p.id,
      status: "pending",
      project: {
        ...p,
        id: "",
      },
    };
  });

  const queue = new PQueue({ concurrency: 3, autoStart: false });

  const envs: Record<
    string,
    {
      name: string;
      projects: string[];
    }
  > = {};
  const features: FeatureImport[] = [];
  const importedFeatureIds: Set<string> = new Set();

  projects.map((p) => {
    // Get environments for each project
    queue.add(async () => {
      try {
        const data = await getLDEnvironments(apiToken, p.key);
        data.items.forEach((env) => {
          envs[env.key] = envs[env.key] || { name: env.name, projects: [] };
          envs[env.key].projects.push(p.key);
        });
      } catch (e) {
        console.error("Error fetching environments for project", p.key, e);
      }
    });

    // Get feature flags for the project
    queue.add(async () => {
      try {
        const data = await getLDFeatureFlags(apiToken, p.key);
        // Build a map of feature key to type and variations
        // This is required for prerequisites
        const featureVarMap: FeatureVariationsMap = new Map();
        data.items.forEach((item) => {
          featureVarMap.set(item.key, getTypeAndVariations(item));
        });

        data.items.forEach((f) => {
          try {
            if (importedFeatureIds.has(f.key)) {
              features.push({
                key: f.key,
                status: "skipped",
                error: "Duplicate feature key",
              });
              return;
            }

            const feature = transformLDFeatureFlag(f, p.key, featureVarMap);
            features.push({
              key: feature.id,
              status: "pending",
              feature,
            });
            importedFeatureIds.add(f.key);
          } catch (e) {
            features.push({
              key: f.key,
              status: "invalid",
              error: e.message,
            });
          }
        });
      } catch (e) {
        console.error("Error fetching feature flags for project", p.key, e);
      }
    });
  });

  queue.start();
  await queue.onIdle();

  return {
    status: "ready",
    projects: projects,
    envs: Object.entries(envs).map(([key, env]) => ({
      key,
      status: existingEnvs.has(key) ? "skipped" : "pending",
      env: {
        id: key,
        description: env.name,
        projects: env.projects,
      },
      error: existingEnvs.has(key) ? "Environment already exists" : undefined,
    })),
    features,
  };
}

async function runImport(
  data: ImportData,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall: ApiCallType<any>,
  callback: (data: ImportData) => void
) {
  // We will mutate this shared object and sync it back to the component periodically
  data = cloneDeep(data);

  // Debounced updater
  let timer: number | null = null;
  const update = () => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = null;
      callback(cloneDeep(data));
    }, 500);
  };

  data.status = "importing";
  update();

  const queue = new PQueue({ concurrency: 3 });

  // Import projects
  data.projects?.forEach((p) => {
    if (p.status === "pending") {
      queue.add(async () => {
        try {
          const res: { project: ProjectInterface } = await apiCall(
            "/projects",
            {
              method: "POST",
              body: JSON.stringify({
                name: p.project?.name,
                description: p.project?.description,
              }),
            }
          );
          p.status = "completed";
          p.project = res.project;
        } catch (e) {
          p.status = "failed";
          p.error = e.message;
        }
        update();
      });
    }
  });
  await queue.onIdle();

  // Mapping of project key to project id
  const projectMap = new Map<string, string>();
  data.projects?.forEach((p) => {
    if (p.project && (p.status === "completed" || p.status === "skipped")) {
      projectMap.set(p.key, p.project.id);
    }
  });

  // Import Environments
  queue.add(async () => {
    // TODO: import environments in a single API call since they are all stored in the same Mongo doc
    data.envs?.forEach((env) => {
      if (env.status === "pending") {
        env.status = "completed";
      }
    });
    update();
  });
  await queue.onIdle();

  // TODO: import features
  data.features?.forEach((f) => {
    if (f.status === "pending") {
      queue.add(async () => {
        try {
          const projectId = projectMap.get(f.feature?.project || "");
          if (projectId) {
            await apiCall(`/feature/${f.key}/sync`, {
              method: "POST",
              body: JSON.stringify({
                ...f.feature,
                project: projectId,
              }),
            });
            f.status = "completed";
          } else {
            f.status = "skipped";
            f.error = "Project not created";
          }
        } catch (e) {
          f.status = "failed";
          f.error = e.message;
        }
        update();
      });
    }
  });
  await queue.onIdle();

  data.status = "completed";
  timer && clearTimeout(timer);
  callback(data);
}

function ImportStatusDisplay({
  data,
}: {
  data: {
    status: ImportStatus;
    error?: string;
  };
}) {
  const color = ["failed", "invalid"].includes(data.status)
    ? "danger"
    : data.status === "completed"
    ? "success"
    : data.status === "skipped"
    ? "secondary"
    : "purple";

  return (
    <Tooltip
      body={
        <div>
          <strong>{data.status}</strong>{" "}
          {data.error ? <>: {data.error}</> : null}
        </div>
      }
    >
      <span className={`text-${color} mr-3`}>
        {data.status === "invalid" ? (
          <FaTriangleExclamation />
        ) : data.status === "skipped" ? (
          <FaMinusCircle />
        ) : data.status === "pending" ? (
          <MdPending />
        ) : data.status === "completed" ? (
          <FaCheck />
        ) : data.status === "failed" ? (
          <FaTriangleExclamation />
        ) : null}
        <span className="ml-1">{data.status}</span>
      </span>
    </Tooltip>
  );
}

function FeatureImportSummary({ data }: { data: FeatureImport }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="mb-2">
      <div className="d-flex">
        <ImportStatusDisplay data={data} />
        <span className="ml-1">{data.key}</span>
        {data.feature?.project && (
          <span className="badge badge-secondary ml-1">
            {data.feature.project}
          </span>
        )}
        {data.feature ? (
          <a
            href="#"
            className="ml-1"
            onClick={(e) => {
              e.preventDefault();
              setOpen(true);
            }}
            title="View Details"
          >
            <FaPlus />
          </a>
        ) : null}
      </div>
      {open && data.feature && (
        <Modal
          open
          close={() => setOpen(false)}
          header={`Feature Details`}
          size="lg"
        >
          <h3>
            {data.key}
            <span className="badge badge-secondary ml-2">
              {data.feature.project}
            </span>
          </h3>
          <Code language="json" code={JSON.stringify(data.feature, null, 2)} />
        </Modal>
      )}
    </li>
  );
}

function ImportHeader({
  name,
  items,
}: {
  name: string;
  items: { status: ImportStatus }[];
}) {
  const countsByStatus = items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {} as Record<ImportStatus, number>);

  return (
    <div className="bg-light p-3 border-bottom">
      <div className="row">
        <div className="col-auto">
          <h3 className="mb-0">{name}</h3>
        </div>
        <div className="col-auto">
          <span className="badge badge-info badge-pill">{items.length}</span>{" "}
          total
        </div>
        <div className="col-auto">
          <span className="badge badge-success badge-pill">
            {countsByStatus["completed"] || 0}
          </span>{" "}
          imported
        </div>
        <div className="col-auto">
          <span className="badge badge-secondary badge-pill">
            {countsByStatus["skipped"] || 0}
          </span>{" "}
          skipped
        </div>
        <div className="col-auto">
          <span className="badge badge-danger badge-pill">
            {(countsByStatus["failed"] || 0) + (countsByStatus["invalid"] || 0)}
          </span>{" "}
          failed
        </div>
      </div>
    </div>
  );
}

export default function ImportFromLaunchDarkly() {
  const [token, setToken] = useLocalStorage("ldApiToken", "");
  const [data, setData] = useState<ImportData>({
    status: "init",
  });

  const { projects, mutateDefinitions } = useDefinitions();
  const environments = useEnvironments();
  const { refreshOrganization } = useUser();

  const existingEnvironments = useMemo(
    () => new Set(environments.map((e) => e.id)),
    [environments]
  );
  const existingProjects = useMemo(
    () => new Map(projects.map((p) => [p.name, p])),
    [projects]
  );
  const { apiCall } = useAuth();

  const step = ["init", "loading", "error"].includes(data.status)
    ? 1
    : data.status === "ready"
    ? 2
    : 3;

  return (
    <div>
      <div className="appbox p-3">
        <div className="row">
          <div className="col">
            <h2>Launch Darkly Importer</h2>
            <Field
              label="API Token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <Button
              type="button"
              color={step === 1 ? "primary" : "outline-primary"}
              onClick={async () => {
                if (!token) return;

                setData({
                  status: "loading",
                });

                try {
                  const d = await buildImportedData(
                    token,
                    existingProjects,
                    existingEnvironments
                  );
                  setData(d);
                } catch (e) {
                  setData({
                    status: "error",
                    error: e.message,
                  });
                }
              }}
            >
              Step 1: Fetch from LaunchDarkly
            </Button>
            <Button
              className="ml-2"
              color={step === 2 ? "primary" : "outline-primary"}
              disabled={step < 2}
              onClick={async () => {
                await runImport(data, apiCall, (d) => setData(d));
                mutateDefinitions();
                refreshOrganization();
              }}
            >
              Step 2: Import to GrowthBook
            </Button>
          </div>
        </div>
      </div>

      <div className="position-relative">
        {data.status === "loading" ? (
          <LoadingOverlay />
        ) : data.status === "error" ? (
          <div className="alert alert-danger">{data.error || "Error"}</div>
        ) : data.status === "init" ? null : (
          <div>
            <h2>Status: {data.status}</h2>
            {data.projects ? (
              <div className="appbox mb-4">
                <ImportHeader name="Projects" items={data.projects} />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <ul className="m-0 p-0">
                      {data.projects?.map((p) => (
                        <li key={p.key} className="mb-2">
                          <ImportStatusDisplay data={p} />
                          {p.project?.name || p.key}
                          <span className="badge badge-secondary ml-1">
                            {p.key}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : null}
            {data.envs ? (
              <div className="appbox mb-4">
                <ImportHeader name="Environmnets" items={data.envs} />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <ul className="m-0 p-0">
                      {data.envs?.map((env) => (
                        <li key={env.key} className="mb-2">
                          <ImportStatusDisplay data={env} />
                          {env.key} ({env.env?.description})
                          {env.env?.projects.map((p) => (
                            <span
                              key={p}
                              className="badge badge-secondary ml-1"
                            >
                              {p}
                            </span>
                          ))}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : null}
            {data.features ? (
              <div className="appbox mb-4">
                <ImportHeader name="Features" items={data.features} />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <ul className="m-0 p-0">
                      {data.features?.map((f) => (
                        <FeatureImportSummary key={f.key} data={f} />
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
