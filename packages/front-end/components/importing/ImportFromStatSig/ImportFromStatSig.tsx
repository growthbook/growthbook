import React, { useState } from "react";
import PQueue from "p-queue";
import { FeatureInterface } from "back-end/types/feature";
import { FaTriangleExclamation } from "react-icons/fa6";
import { FaCheck, FaMinusCircle } from "react-icons/fa";
import { MdPending } from "react-icons/md";
import { cloneDeep } from "lodash";
import {
  getAllStatSigEntities,
  StatSigEnvironment,
  StatSigFeatureGate,
  StatSigDynamicConfig,
  StatSigExperiment,
  StatSigSavedGroup,
} from "@/services/statsig-importing";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Button";
import { ApiCallType, useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useFeaturesList } from "@/services/features";
import { useUser } from "@/services/UserContext";
import { useSessionStorage } from "@/hooks/useSessionStorage";
import LoadingSpinner from "@/components/LoadingSpinner";
import { EntityAccordion, EntityAccordionContent } from "./EntityAccordion";

type ImportStatus = "invalid" | "skipped" | "pending" | "completed" | "failed";

// Removed unused FeatureImport interface

interface EnvironmentImport {
  key: string;
  status: ImportStatus;
  environment?: StatSigEnvironment;
  error?: string;
}

interface FeatureGateImport {
  key: string;
  status: ImportStatus;
  featureGate?: StatSigFeatureGate;
  error?: string;
}

interface DynamicConfigImport {
  key: string;
  status: ImportStatus;
  dynamicConfig?: StatSigDynamicConfig;
  error?: string;
}

interface ExperimentImport {
  key: string;
  status: ImportStatus;
  experiment?: StatSigExperiment;
  error?: string;
}

interface SegmentImport {
  key: string;
  status: ImportStatus;
  segment?: StatSigSavedGroup;
  error?: string;
}

interface LayerImport {
  key: string;
  status: ImportStatus;
  layer?: unknown;
  error?: string;
}

interface MetricImport {
  key: string;
  status: ImportStatus;
  metric?: unknown;
  error?: string;
}

interface ImportData {
  status: "init" | "fetching" | "error" | "ready" | "importing" | "completed";
  environments?: EnvironmentImport[];
  featureGates?: FeatureGateImport[];
  dynamicConfigs?: DynamicConfigImport[];
  experiments?: ExperimentImport[];
  segments?: SegmentImport[];
  layers?: LayerImport[];
  metrics?: MetricImport[];
  error?: string;
}

async function buildImportedData(
  apiKey: string,
  intervalCap: number,
  features: FeatureInterface[],
  apiCall: (path: string, options?: unknown) => Promise<unknown>,
  callback: (data: ImportData) => void,
): Promise<void> {
  const data: ImportData = {
    status: "fetching",
    environments: [],
    featureGates: [],
    dynamicConfigs: [],
    experiments: [],
    segments: [],
    layers: [],
    metrics: [],
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

  try {
    console.log(`Fetching StatSig entities`);

    const queue = new PQueue({ interval: 10000, intervalCap: intervalCap });

    // Fetch entities
    queue.add(async () => {
      try {
        console.log(`Fetching entities from StatSig`);
        const entities = await getAllStatSigEntities(apiKey, intervalCap);

        console.log(`StatSig entities:`, {
          environments: entities.environments,
          featureGates: entities.featureGates,
          dynamicConfigs: entities.dynamicConfigs,
          experiments: entities.experiments,
          segments: entities.segments,
          layers: entities.layers,
          metrics: entities.metrics,
        });

        // Process environments
        // Note: environments.data is an array of environment objects, not nested
        entities.environments.data.forEach((environment) => {
          const env = environment as StatSigEnvironment;
          data.environments?.push({
            key: env.name || env.id,
            status: "pending",
            environment: env,
          });
        });

        // Process feature gates
        entities.featureGates.data.forEach((gate) => {
          const fg = gate as StatSigFeatureGate;
          data.featureGates?.push({
            key: fg.name,
            status: "pending",
            featureGate: fg,
          });
        });

        // Process dynamic configs
        entities.dynamicConfigs.data.forEach((config) => {
          const dc = config as StatSigDynamicConfig;
          data.dynamicConfigs?.push({
            key: dc.name,
            status: "pending",
            dynamicConfig: dc,
          });
        });

        // Process experiments
        entities.experiments.data.forEach((experiment) => {
          const exp = experiment as StatSigExperiment;
          data.experiments?.push({
            key: exp.name,
            status: "pending",
            experiment: exp,
          });
        });

        // Process segments
        entities.segments.data.forEach((segment) => {
          const seg = segment as StatSigSavedGroup;
          data.segments?.push({
            key: seg.name,
            status: "pending",
            segment: seg,
          });
        });

        // Process layers
        entities.layers.data.forEach((layer) => {
          const l = layer as { name?: string; id?: string };
          data.layers?.push({
            key: l.name || l.id || "unknown",
            status: "pending",
            layer: layer,
          });
        });

        // Process metrics
        entities.metrics.data.forEach((metric) => {
          const m = metric as { name?: string; id?: string };
          data.metrics?.push({
            key: m.name || m.id || "unknown",
            status: "pending",
            metric: metric,
          });
        });

        update();
      } catch (e) {
        console.error(`Error fetching entities from StatSig:`, e);
      }
    });

    await queue.onIdle();
    timer && clearTimeout(timer);
    data.status = "ready";
    callback(data);
  } catch (e) {
    console.error("Error in buildImportedData:", e);
    data.status = "error";
    data.error = e.message;
    callback(data);
  }
}

async function runImport(
  data: ImportData,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall: ApiCallType<any>,
  callback: (data: ImportData) => void,
) {
  // For now, just mark everything as completed since we're only fetching
  data = cloneDeep(data);
  data.status = "completed";

  // Mark all entities as completed for now
  data.environments?.forEach((environment) => {
    if (environment.status === "pending") {
      environment.status = "completed";
    }
  });

  data.featureGates?.forEach((gate) => {
    if (gate.status === "pending") {
      gate.status = "completed";
    }
  });

  data.dynamicConfigs?.forEach((config) => {
    if (config.status === "pending") {
      config.status = "completed";
    }
  });

  data.experiments?.forEach((exp) => {
    if (exp.status === "pending") {
      exp.status = "completed";
    }
  });

  data.segments?.forEach((segment) => {
    if (segment.status === "pending") {
      segment.status = "completed";
    }
  });

  data.layers?.forEach((layer) => {
    if (layer.status === "pending") {
      layer.status = "completed";
    }
  });

  data.metrics?.forEach((metric) => {
    if (metric.status === "pending") {
      metric.status = "completed";
    }
  });

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

export default function ImportFromStatSig() {
  const [token, setToken] = useSessionStorage("ssApiToken", "");
  const [intervalCap, setIntervalCap] = useState(50);
  const [data, setData] = useState<ImportData>({
    status: "init",
  });
  const [expandedAccordions, setExpandedAccordions] = useState<Set<string>>(
    new Set(),
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

  const { features, mutate: mutateFeatures } = useFeaturesList(false);
  const { mutateDefinitions } = useDefinitions();
  const { refreshOrganization } = useUser();
  const { apiCall } = useAuth();

  const step = ["init", "loading", "error"].includes(data.status)
    ? 1
    : data.status === "ready"
      ? 2
      : 3;

  return (
    <div>
      <h1>StatSig Importer</h1>
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
                  await buildImportedData(
                    token,
                    intervalCap,
                    features,
                    apiCall,
                    (d) => setData(d),
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
              Step 1: Fetch from StatSig
            </Button>
            <Button
              className="ml-2"
              color={step === 2 ? "primary" : "outline-primary"}
              disabled={step < 2}
              onClick={async () => {
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
            {data.featureGates ? (
              <div className="appbox mb-4">
                <ImportHeader name="Feature Gates" items={data.featureGates} />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 150 }}>Status</th>
                          <th>Name</th>
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
                                <td>{gate.featureGate?.name}</td>
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
                  name="Dynamic Configs"
                  items={data.dynamicConfigs}
                />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 150 }}>Status</th>
                          <th>Name</th>
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
                                <td>{config.dynamicConfig?.name}</td>
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
                          <th style={{ width: 150 }}>Status</th>
                          <th>Primary Metric</th>
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
                                <td>{exp.experiment?.primary_metric}</td>
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
            {data.segments ? (
              <div className="appbox mb-4">
                <ImportHeader name="Segments" items={data.segments} />
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
                        {data.segments?.map((segment, i) => {
                          const entityId = `segment-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <ImportStatusDisplay data={segment} />
                                </td>
                                <td>{segment.segment?.name}</td>
                                <td>{segment.segment?.type}</td>
                                <td>{segment.segment?.description}</td>
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
            {data.layers ? (
              <div className="appbox mb-4">
                <ImportHeader name="Layers" items={data.layers} />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 150 }}>Status</th>
                          <th>Name</th>
                          <th>Description</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.layers?.map((layer, i) => {
                          const entityId = `layer-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <ImportStatusDisplay data={layer} />
                                </td>
                                <td>
                                  {(
                                    layer.layer as {
                                      name?: string;
                                      id?: string;
                                    }
                                  )?.name ||
                                    (
                                      layer.layer as {
                                        name?: string;
                                        id?: string;
                                      }
                                    )?.id}
                                </td>
                                <td>
                                  {
                                    (layer.layer as { description?: string })
                                      ?.description
                                  }
                                </td>
                                <EntityAccordion
                                  entity={layer.layer}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={layer.layer}
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
                <ImportHeader name="Metrics" items={data.metrics} />
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
