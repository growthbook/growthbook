import React, { useState } from "react";
import { ProjectInterface } from "back-end/types/project";
import PQueue from "p-queue";
import { FeatureInterface } from "back-end/types/feature";
import { FaTriangleExclamation } from "react-icons/fa6";
import { FaCheck, FaMinusCircle, FaPlus } from "react-icons/fa";
import { MdPending } from "react-icons/md";
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

async function buildImportedData(apiToken: string): Promise<ImportData> {
  // Get projects
  const projects = await getLDProjects(apiToken);

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

  projects.items.map((p) => {
    // Get environments for each project
    queue.add(async () => {
      try {
        const data = await getLDEnvironments(apiToken, p.key);
        console.log("Environments API response", {
          project: p.key,
          data,
        });
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
        console.log("Feature flag API response", {
          project: p.key,
          data,
        });

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
    projects: transformLDProjectsToGBProject(projects).map((p) => ({
      key: p.id,
      status: "pending",
      project: p,
    })),
    envs: Object.entries(envs).map(([key, env]) => ({
      key,
      status: "pending",
      env: {
        id: key,
        description: env.name,
        projects: env.projects,
      },
    })),
    features,
  };
}

function ImportStatusDisplay({
  data,
}: {
  data: {
    status: ImportStatus;
    error?: string;
  };
}) {
  return (
    <Tooltip
      body={
        data.error ? (
          <div>
            <strong>{data.status}</strong>: {data.error}
          </div>
        ) : (
          data.status
        )
      }
    >
      {data.status === "invalid" ? (
        <FaTriangleExclamation className="text-danger" />
      ) : data.status === "skipped" ? (
        <FaMinusCircle className="text-secondary" />
      ) : data.status === "pending" ? (
        <MdPending className="text-purple" />
      ) : data.status === "completed" ? (
        <FaCheck className="text-success" />
      ) : data.status === "failed" ? (
        <FaTriangleExclamation className="text-danger" />
      ) : null}
    </Tooltip>
  );
}

function FeatureImportSummary({ data }: { data: FeatureImport }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
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

export default function ImportFromLaunchDarkly() {
  const [token, setToken] = useLocalStorage("ldApiToken", "");
  const [data, setData] = useState<ImportData>({
    status: "init",
  });

  const step = ["init", "loading", "error"].includes(data.status) ? 1 : 2;

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
                  const d = await buildImportedData(token);
                  setData(d);
                } catch (e) {
                  setData({
                    status: "error",
                    error: e.message,
                  });
                }
              }}
            >
              Step 1: Preview
            </Button>
            <Button
              className="ml-2"
              color={step === 2 ? "primary" : "outline-primary"}
              disabled={step < 2}
              onClick={async () => {
                console.log("running");
              }}
            >
              Step 2: Run Import
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
            <div className="appbox p-3">
              <h3>Projects</h3>
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                <ul>
                  {data.projects?.map((p) => (
                    <li key={p.key}>
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
            <div className="appbox p-3">
              <h3>Environments</h3>
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                <ul>
                  {data.envs?.map((env) => (
                    <li key={env.key}>
                      <ImportStatusDisplay data={env} />
                      {env.key} ({env.env?.description})
                      {env.env?.projects.map((p) => (
                        <span key={p} className="badge badge-secondary ml-1">
                          {p}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="appbox p-3">
              <h3>Features</h3>
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                <ul>
                  {data.features?.map((f) => (
                    <FeatureImportSummary key={f.key} data={f} />
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
