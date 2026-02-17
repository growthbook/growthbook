import React, { useEffect, useMemo, useState } from "react";
import { ProjectInterface } from "shared/types/project";
import PQueue from "p-queue";
import { FeatureInterface } from "shared/types/feature";
import { FaTriangleExclamation } from "react-icons/fa6";
import {
  FaCheck,
  FaExternalLinkAlt,
  FaMinusCircle,
  FaRegWindowRestore,
} from "react-icons/fa";
import { MdPending } from "react-icons/md";
import { cloneDeep, isEqual } from "lodash";
import { Environment } from "shared/types/organization";
import Link from "next/link";
import DiffViewerClient, {
  DiffMethod,
} from "@/components/DiffViewer/DiffViewerClient";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import Code from "@/components/SyntaxHighlighting/Code";
import Modal from "@/components/Modal";
import Button from "@/components/Button";
import Checkbox from "@/ui/Checkbox";
import { ApiCallType, useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments, useFeaturesList } from "@/services/features";
import { useUser } from "@/services/UserContext";
import { useSessionStorage } from "@/hooks/useSessionStorage";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import LoadingSpinner from "@/components/LoadingSpinner";
import { isCloud } from "@/services/env";
import {
  FeatureVariationsMap,
  getLDEnvironments,
  getLDFeatureFlag,
  getLDFeatureFlags,
  getLDProjects,
  getTypeAndVariations,
  transformLDFeatureFlag,
  transformLDProjectsToGBProject,
} from "@/services/importing/launchdarkly/launchdarkly-importing";
import track from "@/services/track";

type ImportStatus = "invalid" | "skipped" | "pending" | "completed" | "failed";

type PartialFeature = Omit<
  FeatureInterface,
  "organization" | "dateCreated" | "dateUpdated" | "version"
>;

interface FeatureImport {
  key: string;
  status: ImportStatus;
  feature?: PartialFeature;
  error?: string;
  existing?: FeatureInterface;
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
  status: "init" | "fetching" | "error" | "ready" | "importing" | "completed";
  projects?: ProjectImport[];
  envs?: EnvironmentImport[];
  features?: FeatureImport[];
  error?: string;
}

function getFeatureComp(existing: PartialFeature, incoming: PartialFeature) {
  const envSettings1 = existing.environmentSettings || {};
  const envSettings2 = incoming.environmentSettings || {};

  // Get intersection of environments
  const envs = Object.keys(envSettings1).filter((e) => e in envSettings2);

  return [
    {
      description: existing.description,
      defaultValue: existing.defaultValue,
      tags: existing.tags,
      owner: existing.owner,
      rules: Object.fromEntries(
        Object.entries(envSettings1)
          .filter(([e]) => envs.includes(e))
          .map(([e, v]) => [e, v.rules]),
      ),
    },
    {
      description: incoming.description,
      defaultValue: incoming.defaultValue,
      tags: incoming.tags,
      owner: incoming.owner,
      rules: Object.fromEntries(
        Object.entries(envSettings2)
          .filter(([e]) => envs.includes(e))
          .map(([e, v]) => [e, v.rules]),
      ),
    },
  ];
}
function isDifferent(feature1: PartialFeature, feature2: PartialFeature) {
  const featureComp = getFeatureComp(feature1, feature2);
  return !isEqual(featureComp[0], featureComp[1]);
}
function FeatureDiff({
  existing,
  incoming,
}: {
  existing: PartialFeature;
  incoming: PartialFeature;
}) {
  const featureComp = getFeatureComp(existing, incoming);
  const a = JSON.stringify(featureComp[0], null, 2);
  const b = JSON.stringify(featureComp[1], null, 2);

  return (
    <DiffViewerClient
      oldValue={a}
      newValue={b}
      compareMethod={DiffMethod.LINES}
      styles={{
        contentText: {
          wordBreak: "break-all",
        },
      }}
    />
  );
}

async function buildImportedData(
  apiToken: string,
  intervalCap: number,
  existingProjects: Map<string, ProjectInterface>,
  existingEnvs: Set<string>,
  features: FeatureInterface[],
  callback: (data: ImportData) => void,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<void> {
  const featuresMap = new Map(features.map((f) => [f.id, f]));

  const data: ImportData = {
    status: "fetching",
    envs: [],
    projects: [],
    features: [],
  };

  // Debounced updater
  let timer: number | null = null;
  const update = () => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = null;
      callback(cloneDeep(data));
    }, 500);
  };

  // Get projects
  const ldProjects = await getLDProjects(apiToken, useBackendProxy, apiCall);
  const projects: ProjectImport[] = transformLDProjectsToGBProject(
    ldProjects,
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
  data.projects = projects;
  update();

  const queue = new PQueue({ interval: 10000, intervalCap: intervalCap });

  const envs: Record<
    string,
    {
      name: string;
      projects: string[];
    }
  > = {};
  const importedFeatureIds: Set<string> = new Set();

  function getEnvs(): EnvironmentImport[] {
    return Object.entries(envs).map(([key, env]) => ({
      key,
      status: existingEnvs.has(key) ? "skipped" : "pending",
      env: {
        id: key,
        description: env.name,
        projects: env.projects,
      },
      error: existingEnvs.has(key) ? "Environment already exists" : undefined,
    }));
  }

  projects.map((p) => {
    // Get environments for each project
    queue.add(async () => {
      try {
        const ldEnvs = await getLDEnvironments(
          apiToken,
          p.key,
          useBackendProxy,
          apiCall,
        );
        ldEnvs.items.forEach((env) => {
          envs[env.key] = envs[env.key] || { name: env.name, projects: [] };
          envs[env.key].projects.push(p.key);
        });
        data.envs = getEnvs();
        update();
      } catch (e) {
        console.error("Error fetching environments for project", p.key, e);
      }
    });

    // Get feature flags for the project
    queue.add(async () => {
      try {
        const ldFeatures = await getLDFeatureFlags(
          apiToken,
          p.key,
          useBackendProxy,
          apiCall,
        );
        // Build a map of feature key to type and variations
        // This is required for prerequisites
        const featureVarMap: FeatureVariationsMap = new Map();
        ldFeatures.items.forEach((item) => {
          featureVarMap.set(item.key, getTypeAndVariations(item));
        });

        ldFeatures.items.forEach((f) => {
          if (importedFeatureIds.has(f.key)) {
            data.features?.push({
              key: f.key,
              status: "skipped",
              error: "Duplicate feature key",
              existing: featuresMap.get(f.key),
            });
            update();
            return;
          }

          importedFeatureIds.add(f.key);
          queue.add(async () => {
            try {
              const def = await getLDFeatureFlag(
                apiToken,
                p.key,
                f.key,
                useBackendProxy,
                apiCall,
              );
              try {
                const feature = transformLDFeatureFlag(
                  def,
                  p.key,
                  featureVarMap,
                );

                // Check if anything substantial has changed
                const existing = featuresMap.get(f.key);
                if (existing && !isDifferent(existing, feature)) {
                  data.features?.push({
                    key: f.key,
                    status: "skipped",
                    error: "No changes",
                    feature,
                    existing,
                  });
                } else {
                  data.features?.push({
                    key: feature.id,
                    status: "pending",
                    feature,
                    existing,
                  });
                }
              } catch (e) {
                data.features?.push({
                  key: f.key,
                  status: "invalid",
                  error: e.message,
                  existing: featuresMap.get(f.key),
                });
              }
            } catch (e) {
              data.features?.push({
                key: f.key,
                status: "failed",
                error: e.message,
                existing: featuresMap.get(f.key),
              });
            }
            update();
          });
        });
      } catch (e) {
        console.error("Error fetching feature flags for project", p.key, e);
      }
    });
  });

  await queue.onIdle();
  timer && clearTimeout(timer);
  data.status = "ready";
  callback(data);
}

async function runImport(
  data: ImportData,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall: ApiCallType<any>,
  callback: (data: ImportData) => void,
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

  const queue = new PQueue({ concurrency: 6 });

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
            },
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

  // Import Environments in a single API call
  queue.add(async () => {
    const envsToAdd: Environment[] = [];
    data.envs?.forEach((e) => {
      if (e.status === "pending" && e.env) {
        envsToAdd.push({
          id: e.env.id,
          description: e.env.description,
        });
      }
    });

    if (envsToAdd.length > 0) {
      try {
        await apiCall("/environment", {
          method: "PUT",
          body: JSON.stringify({
            environments: envsToAdd,
          }),
        });
        data.envs?.forEach((env) => {
          if (env.status === "pending") {
            env.status = "completed";
          }
        });
      } catch (e) {
        data.envs?.forEach((env) => {
          if (env.status === "pending") {
            env.status = "failed";
            env.error = e.message;
          }
        });
      }
    }
    update();
  });
  await queue.onIdle();

  data.features?.forEach((f) => {
    if (f.status === "pending") {
      queue.add(async () => {
        try {
          const projectId = projectMap.get(f.feature?.project || "");
          if (projectId) {
            const res: { feature: FeatureInterface } = await apiCall(
              `/feature/${f.key}/sync`,
              {
                method: "POST",
                body: JSON.stringify({
                  ...f.feature,
                  project: projectId,
                }),
              },
            );
            f.status = "completed";
            f.existing = res.feature;
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
        : "info";

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

function FeatureImportRow({
  data,
  skip,
  overallStatus,
}: {
  data: FeatureImport;
  skip: () => void;
  overallStatus: ImportData["status"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <td>
          <ImportStatusDisplay data={data} />
        </td>
        <td>
          {data.feature ? (
            <span className="badge badge-secondary">
              {data.feature.project}
            </span>
          ) : null}
        </td>
        <td>
          {data.existing ? (
            <Link href={`/features/${data.key}`}>
              {data.key} <FaExternalLinkAlt />
            </Link>
          ) : (
            data.key
          )}
        </td>
        <td>
          {data.feature ? (
            <a
              href="#"
              className="ml-1"
              onClick={(e) => {
                e.preventDefault();
                setOpen(true);
              }}
            >
              open <FaRegWindowRestore />
            </a>
          ) : null}
        </td>
        <td>
          {data.error ? (
            <em>{data.error}</em>
          ) : data.status === "pending" && overallStatus === "ready" ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                skip();
              }}
            >
              skip
            </a>
          ) : null}
        </td>
      </tr>
      {open && data.feature && (
        <Modal
          trackingEventModalType=""
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

          {data.status === "pending" && data.existing ? (
            <>
              <p>The feature already exists and will be updated as follows:</p>
              <FeatureDiff existing={data.existing} incoming={data.feature} />
            </>
          ) : (
            <>
              {!data.existing ? (
                <p>
                  The feature does not exist yet and will be created as follows:
                </p>
              ) : null}
              <Code
                language="json"
                code={JSON.stringify(data.feature, null, 2)}
              />
            </>
          )}
        </Modal>
      )}
    </>
  );
}

function ImportHeader({
  name,
  items,
}: {
  name: string;
  items: { status: ImportStatus }[];
}) {
  const countsByStatus = items.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    {} as Record<ImportStatus, number>,
  );

  return (
    <div className="bg-light p-3 border-bottom">
      <div className="row">
        <div className="col-auto">
          <h3 className="mb-0">{name}</h3>
        </div>
        <div className="col-auto mr-4">
          <strong>{items.length}</strong> total
        </div>
        <div className="col-auto">
          <span className="badge badge-info badge-pill">
            {countsByStatus["pending"] || 0}
          </span>{" "}
          pending
        </div>
        <div className="col-auto">
          <span className="badge badge-secondary badge-pill">
            {countsByStatus["skipped"] || 0}
          </span>{" "}
          skipped
        </div>
        <div className="col-auto">
          <span className="badge badge-success badge-pill">
            {countsByStatus["completed"] || 0}
          </span>{" "}
          imported
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
  const [token, setToken] = useSessionStorage("ldApiToken", "");
  const [intervalCap, setIntervalCap] = useState(50);
  const [useBackendProxy, setUseBackendProxy] = useLocalStorage(
    "launchdarkly_use_backend_proxy",
    false,
  );
  const [data, setData] = useState<ImportData>({
    status: "init",
  });

  // Force useBackendProxy to false for cloud users
  useEffect(() => {
    if (isCloud() && useBackendProxy) {
      setUseBackendProxy(false);
    }
  }, [useBackendProxy, setUseBackendProxy]);

  const { features, mutate: mutateFeatures } = useFeaturesList({
    useCurrentProject: false,
  });
  const { projects, mutateDefinitions } = useDefinitions();
  const environments = useEnvironments();
  const { refreshOrganization } = useUser();

  const existingEnvironments = useMemo(
    () => new Set(environments.map((e) => e.id)),
    [environments],
  );
  const existingProjects = useMemo(
    () => new Map(projects.map((p) => [p.name, p])),
    [projects],
  );
  const { apiCall } = useAuth();

  const step = ["init", "loading", "error"].includes(data.status)
    ? 1
    : data.status === "ready"
      ? 2
      : 3;

  return (
    <div>
      <h1>LaunchDarkly Importer</h1>
      <p>
        Import your existing projects, environments, and feature flags from the
        LaunchDarkly API.
      </p>
      <div className="appbox p-3">
        <div className="row">
          <div className="col">
            <div className="row">
              <div className="col">
                <Field
                  label="API Token"
                  value={token}
                  type="password"
                  onChange={(e) => setToken(e.target.value)}
                  helpText="Needs read access to LaunchDarkly projects, environments, and feature flags"
                />
              </div>
              <div className="col-auto">
                <Field
                  label="Max requests per 10 secs"
                  type="number"
                  value={intervalCap}
                  helpText="Lower this if you are getting rate limited"
                  onChange={(e) => setIntervalCap(parseInt(e.target.value))}
                />
              </div>
              {!isCloud() && (
                <div className="col-auto" style={{ maxWidth: 180 }}>
                  <label className="form-label d-block">Backend Proxy</label>
                  <Checkbox
                    label="Proxy through API"
                    value={useBackendProxy}
                    setValue={setUseBackendProxy}
                    size="lg"
                    weight="regular"
                    mt="2"
                  />
                  <div className="text-muted small mt-1">
                    Workaround for HTTP origin requests
                  </div>
                </div>
              )}
            </div>
            <Button
              type="button"
              color={step === 1 ? "primary" : "outline-primary"}
              onClick={async () => {
                if (!token) return;

                track("LaunchDarkly import fetch started", {
                  source: "launchdarkly",
                  step: 1,
                });

                setData({
                  status: "fetching",
                });

                try {
                  await buildImportedData(
                    token,
                    intervalCap,
                    existingProjects,
                    existingEnvironments,
                    features,
                    (d) => setData(d),
                    isCloud() ? false : useBackendProxy,
                    apiCall,
                  );
                } catch (e) {
                  setData({
                    ...data,
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
                track("LaunchDarkly import started", {
                  source: "launchdarkly",
                  step: 2,
                });

                await runImport(data, apiCall, (d) => setData(d));
                mutateDefinitions();
                mutateFeatures();
                refreshOrganization();
              }}
            >
              Step 2: Import to GrowthBook
            </Button>
          </div>
        </div>
      </div>

      <div className="position-relative">
        {data.status === "error" ? (
          <div className="alert alert-danger">{data.error || "Error"}</div>
        ) : data.status === "init" ? null : (
          <div>
            <h2>
              Status: {data.status}{" "}
              {data.status === "fetching" ? <LoadingSpinner /> : null}
            </h2>
            {data.projects ? (
              <div className="appbox mb-4">
                <ImportHeader name="Projects" items={data.projects} />
                <div>
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-auto">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Project Id</th>
                          <th>Name</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.projects?.map((p) => (
                          <tr key={p.key} className="mb-2">
                            <td>
                              <ImportStatusDisplay data={p} />
                            </td>
                            <td>
                              <span className="badge badge-secondary">
                                {p.key}
                              </span>
                            </td>
                            <td>{p.project?.name || p.key}</td>
                            <td>
                              <em>{p.error}</em>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
            {data.envs ? (
              <div className="appbox mb-4">
                <ImportHeader name="Environments" items={data.envs} />
                <div style={{ maxHeight: 400, overflowY: "auto" }}>
                  <table className="gbtable table w-auto">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Id</th>
                        <th>Name</th>
                        <th>Projects</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.envs?.map((env) => (
                        <tr key={env.key} className="mb-2">
                          <td>
                            <ImportStatusDisplay data={env} />
                          </td>
                          <td>{env.key}</td>
                          <td>{env.env?.description}</td>
                          <td>
                            {env.env?.projects.map((p) => (
                              <span
                                key={p}
                                className="badge badge-secondary mr-1"
                              >
                                {p}
                              </span>
                            ))}
                          </td>
                          <td>
                            <em>{env.error}</em>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {data.features ? (
              <div className="appbox mb-4">
                <ImportHeader name="Features" items={data.features} />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-auto">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Project</th>
                          <th>Id</th>
                          <th>Definition</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.features?.map((f, i) => (
                          <FeatureImportRow
                            key={i}
                            data={f}
                            skip={() => {
                              f.status = "skipped";
                              f.error = "Manually skipped";
                              setData(cloneDeep(data));
                            }}
                            overallStatus={data.status}
                          />
                        ))}
                      </tbody>
                    </table>
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
