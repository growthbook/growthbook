import React, { useMemo, useState } from "react";
import { FaTriangleExclamation } from "react-icons/fa6";
import { FaCheck, FaMinusCircle } from "react-icons/fa";
import { MdPending } from "react-icons/md";
import { FeatureInterface } from "back-end/types/feature";
import { ProjectInterface } from "back-end/types/project";
import {
  buildImportedData,
  runImport,
} from "@/services/importing/statsig/statsig-importing";
import { ImportStatus, ImportData } from "@/services/importing/statsig/types";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Button";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  useEnvironments,
  useFeaturesList,
  useAttributeSchema,
} from "@/services/features";
import { useExperiments } from "@/hooks/useExperiments";
import { useUser } from "@/services/UserContext";
import { useSessionStorage } from "@/hooks/useSessionStorage";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import LoadingSpinner from "@/components/LoadingSpinner";
import { EntityAccordion, EntityAccordionContent } from "./EntityAccordion";

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

function ImportHeader({
  name,
  items,
  beta,
}: {
  name: string;
  items: { status: ImportStatus }[];
  beta?: boolean;
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
        <div className="col-auto" style={{ minWidth: 300 }}>
          <h3 className="mb-0">
            {name}
            {beta ? (
              <span className="ml-1 badge badge-warning badge-pill">Beta</span>
            ) : null}
          </h3>
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

export default function ImportFromStatsig2() {
  const [token, setToken] = useSessionStorage("ssApiToken", "");
  const [intervalCap, setIntervalCap] = useState(50);
  const [data, setData] = useState<ImportData>({
    status: "init",
  });
  const [featuresMap, setFeaturesMap] = useState<Map<
    string,
    FeatureInterface
  > | null>(null);
  const [expandedAccordions, setExpandedAccordions] = useState<Set<string>>(
    new Set(),
  );
  const [projectName, setProjectName] = useLocalStorage(
    "statsig_import_project",
    "",
  );

  const toggleAccordion = (id: string) => {
    setExpandedAccordions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const { refreshOrganization } = useUser();
  const { apiCall } = useAuth();

  const { features, mutate: mutateFeatures } = useFeaturesList(false);
  const { mutateDefinitions, savedGroups, tags, projects } = useDefinitions();
  const { experiments } = useExperiments();
  const environments = useEnvironments();
  const attributeSchema = useAttributeSchema();
  const existingEnvironments = useMemo(
    () => new Set(environments.map((e) => e.id)),
    [environments],
  );
  const existingSavedGroups = useMemo(
    () => new Set(savedGroups.map((sg) => sg.groupName)),
    [savedGroups],
  );
  const existingTags = useMemo(
    () => new Set((tags || []).map((t) => t.id)),
    [tags],
  );
  const existingExperiments = useMemo(
    () => new Set((experiments || []).map((e) => e.trackingKey)),
    [experiments],
  );

  // Function to create or find project
  const getOrCreateProject = async (projectName: string): Promise<string> => {
    if (!projectName.trim()) {
      return ""; // Empty string means "All projects"
    }

    // Check if project already exists
    const existingProject = projects.find((p) => p.name === projectName.trim());
    if (existingProject) {
      return existingProject.id;
    }

    // Create new project
    const newProject: ProjectInterface = await apiCall("/projects", {
      method: "POST",
      body: JSON.stringify({
        name: projectName.trim(),
        description: `Created during Statsig import on ${new Date().toISOString()}`,
      }),
    });

    // Refresh projects list
    await mutateDefinitions();

    return newProject.id;
  };

  const step = ["init", "loading", "error"].includes(data.status)
    ? 1
    : data.status === "ready"
      ? 2
      : 3;

  return (
    <div>
      <h1>Statsig Importer</h1>
      <p>
        Import your existing projects, environments, and feature flags from the
        StatSig API.
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
                  helpText="Console API Key from StatSig Project Settings > API Keys"
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
              <div className="col" style={{ maxWidth: 350 }}>
                <Field
                  label="GrowthBook Project"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="All projects"
                  helpText="Import into a specific project. Leave blank for no project"
                />
              </div>
            </div>
            <Button
              type="button"
              color={step === 1 ? "primary" : "outline-primary"}
              onClick={async () => {
                if (!token) return;

                setData({
                  status: "fetching",
                });

                try {
                  const featuresMap = await buildImportedData(
                    token,
                    intervalCap,
                    features,
                    existingEnvironments,
                    existingSavedGroups,
                    existingTags,
                    existingExperiments,
                    attributeSchema,
                    apiCall,
                    (d) => setData(d),
                  );
                  // Store featuresMap for use in runImport
                  setFeaturesMap(featuresMap);
                } catch (e) {
                  setData({
                    ...data,
                    status: "error",
                    error: e.message,
                  });
                }
              }}
            >
              Step 1: Fetch from StatSig
            </Button>
            <Button
              className="ml-2"
              color={step === 2 ? "primary" : "outline-primary"}
              disabled={step < 2}
              onClick={async () => {
                if (!featuresMap) {
                  console.error("featuresMap not available");
                  return;
                }
                const projectId = await getOrCreateProject(projectName);
                await runImport(
                  data,
                  attributeSchema,
                  apiCall,
                  (d) => setData(d),
                  featuresMap,
                  projectId,
                );
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
            {data.environments ? (
              <div className="appbox mb-4">
                <ImportHeader name="Environments" items={data.environments} />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 150 }}>Status</th>
                          <th>Name</th>
                          <th></th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.environments?.map((environment, i) => {
                          const entityId = `environment-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <ImportStatusDisplay data={environment} />
                                </td>
                                <td>{environment.environment?.name}</td>
                                <td>
                                  {environment.error ? (
                                    <em>{environment.error}</em>
                                  ) : null}
                                </td>
                                <EntityAccordion
                                  entity={environment.environment}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={environment.environment}
                                isExpanded={isExpanded}
                              />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {data.tags ? (
              <div className="appbox mb-4">
                <ImportHeader name="Tags" items={data.tags} />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 150 }}>Status</th>
                          <th>Tag</th>
                          <th>Description</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.tags?.map((tag, i) => {
                          const entityId = `tag-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <ImportStatusDisplay data={tag} />
                                </td>
                                <td>{tag.tag?.name || "Unknown"}</td>
                                <td>{tag.tag?.description}</td>
                                <EntityAccordion
                                  entity={tag.tag}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={tag.tag}
                                isExpanded={isExpanded}
                              />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {data.segments ? (
              <div className="appbox mb-4">
                <ImportHeader
                  name="Segments → Saved Groups"
                  items={data.segments}
                />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 150 }}>Status</th>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Description</th>
                          <th></th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.segments?.map((segment, i) => {
                          const entityId = `segment-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <ImportStatusDisplay data={segment} />
                                </td>
                                <td>
                                  {segment.segment?.name ?? segment.segment?.id}
                                </td>
                                <td>{segment.segment?.type}</td>
                                <td>{segment.segment?.description}</td>
                                <td>
                                  {segment.error ? (
                                    <em>{segment.error}</em>
                                  ) : null}
                                </td>
                                <EntityAccordion
                                  entity={segment.segment}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={segment.segment}
                                isExpanded={isExpanded}
                              />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {data.featureGates ? (
              <div className="appbox mb-4">
                <ImportHeader
                  name="Feature Gates → Features"
                  items={data.featureGates}
                />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 150 }}>Status</th>
                          <th>ID</th>
                          <th>Description</th>
                          <th>Enabled</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.featureGates?.map((gate, i) => {
                          const entityId = `featureGate-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <ImportStatusDisplay data={gate} />
                                </td>
                                <td>{gate.featureGate?.id}</td>
                                <td>{gate.featureGate?.description}</td>
                                <td>
                                  {gate.featureGate?.isEnabled ? "Yes" : "No"}
                                </td>
                                <EntityAccordion
                                  entity={gate.featureGate}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={gate.featureGate}
                                isExpanded={isExpanded}
                              />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {data.dynamicConfigs ? (
              <div className="appbox mb-4">
                <ImportHeader
                  name="Dynamic Configs → Features"
                  items={data.dynamicConfigs}
                />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 150 }}>Status</th>
                          <th>ID</th>
                          <th>Description</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.dynamicConfigs?.map((config, i) => {
                          const entityId = `dynamicConfig-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <ImportStatusDisplay data={config} />
                                </td>
                                <td>{config.dynamicConfig?.id}</td>
                                <td>{config.dynamicConfig?.description}</td>
                                <EntityAccordion
                                  entity={config.dynamicConfig}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={config.dynamicConfig}
                                isExpanded={isExpanded}
                              />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {data.experiments ? (
              <div className="appbox mb-4">
                <ImportHeader name="Experiments" items={data.experiments} />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 150 }}>Status</th>
                          <th>Name</th>
                          <th>Experiment Status</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.experiments?.map((exp, i) => {
                          const entityId = `experiment-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <ImportStatusDisplay data={exp} />
                                </td>
                                <td>{exp.experiment?.name}</td>
                                <td>{exp.experiment?.status}</td>
                                <EntityAccordion
                                  entity={exp.experiment}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={exp.experiment}
                                isExpanded={isExpanded}
                              />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {data.metrics ? (
              <div className="appbox mb-4">
                <ImportHeader name="Metrics" beta={true} items={data.metrics} />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 150 }}>Status</th>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Description</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.metrics?.map((metric, i) => {
                          const entityId = `metric-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <ImportStatusDisplay data={metric} />
                                </td>
                                <td>
                                  {(
                                    metric.metric as {
                                      name?: string;
                                      id?: string;
                                    }
                                  )?.name ||
                                    (
                                      metric.metric as {
                                        name?: string;
                                        id?: string;
                                      }
                                    )?.id}
                                </td>
                                <td>
                                  {(metric.metric as { type?: string })?.type}
                                </td>
                                <td>
                                  {
                                    (metric.metric as { description?: string })
                                      ?.description
                                  }
                                </td>
                                <EntityAccordion
                                  entity={metric.metric}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={metric.metric}
                                isExpanded={isExpanded}
                              />
                            </React.Fragment>
                          );
                        })}
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
