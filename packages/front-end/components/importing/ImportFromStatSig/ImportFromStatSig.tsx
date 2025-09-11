import React, { useMemo, useState } from "react";
import { ProjectInterface } from "back-end/types/project";
import PQueue from "p-queue";
import { FeatureInterface } from "back-end/types/feature";
import { FaTriangleExclamation } from "react-icons/fa6";
import {
  FaCheck,
  FaMinusCircle,
} from "react-icons/fa";
import { MdPending } from "react-icons/md";
import { cloneDeep } from "lodash";
import { Environment } from "back-end/types/organization";
import {
  getAllStatSigEntities,
  StatSigFeatureGate,
  StatSigDynamicConfig,
  StatSigExperiment,
  StatSigSavedGroup,
} from "@/services/statsig-importing";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import Code from "@/components/SyntaxHighlighting/Code";
import Modal from "@/components/Modal";
import Button from "@/components/Button";
import { ApiCallType, useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments, useFeaturesList } from "@/services/features";
import { useUser } from "@/services/UserContext";
import { useSessionStorage } from "@/hooks/useSessionStorage";
import LoadingSpinner from "@/components/LoadingSpinner";

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
  layer?: any;
  error?: string;
}

interface MetricImport {
  key: string;
  status: ImportStatus;
  metric?: any;
  error?: string;
}

interface ImportData {
  status: "init" | "fetching" | "error" | "ready" | "importing" | "completed";
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
  apiCall: (path: string, options?: any) => Promise<any>,
  callback: (data: ImportData) => void,
): Promise<void> {
  const data: ImportData = {
    status: "fetching",
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
        const entities = await getAllStatSigEntities(apiKey, apiCall, intervalCap);
          
        console.log(`StatSig entities:`, {
          featureGates: entities.featureGates,
          dynamicConfigs: entities.dynamicConfigs,
          experiments: entities.experiments,
          segments: entities.segments,
          layers: entities.layers,
          metrics: entities.metrics,
        });

        // Process feature gates
        entities.featureGates.data.forEach((gate) => {
          data.featureGates?.push({
            key: gate.name,
            status: "pending",
            featureGate: gate,
          });
        });

        // Process dynamic configs
        entities.dynamicConfigs.data.forEach((config) => {
          data.dynamicConfigs?.push({
            key: config.name,
            status: "pending",
            dynamicConfig: config,
          });
        });

        // Process experiments
        entities.experiments.data.forEach((experiment) => {
          data.experiments?.push({
            key: experiment.name,
            status: "pending",
            experiment: experiment,
          });
        });

        // Process segments
        entities.segments.data.forEach((segment) => {
          data.segments?.push({
            key: segment.name,
            status: "pending",
            segment: segment,
          });
        });

        // Process layers
        entities.layers.data.forEach((layer) => {
          data.layers?.push({
            key: layer.name || layer.id,
            status: "pending",
            layer: layer,
          });
        });

        // Process metrics
        entities.metrics.data.forEach((metric) => {
          data.metrics?.push({
            key: metric.name || metric.id,
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
  data = cloneDeep(data);
  data.status = "importing";
  callback(data);

  try {
    // Prepare bulk import data
    const bulkData = {
      featureGates: data.featureGates?.filter(g => g.status === "pending" && g.featureGate).map(g => g.featureGate) || [],
      dynamicConfigs: data.dynamicConfigs?.filter(c => c.status === "pending" && c.dynamicConfig).map(c => c.dynamicConfig) || [],
      layers: data.layers?.filter(l => l.status === "pending" && l.layer).map(l => l.layer) || [],
      experiments: data.experiments?.filter(e => e.status === "pending" && e.experiment).map(e => e.experiment) || [],
      segments: data.segments?.filter(s => s.status === "pending" && s.segment).map(s => s.segment) || [],
      metrics: data.metrics?.filter(m => m.status === "pending" && m.metric).map(m => m.metric) || [],
      datasourceId: "default", // TODO: Get from user selection
    };

    // Make single bulk import call
    console.log("Sending bulk import data:", bulkData);
    const response = await apiCall("/statsig-import/bulk", {
      method: "POST",
      body: JSON.stringify(bulkData),
    });
    console.log("Bulk import response:", response);

    // Update status based on results
    if (response && response.results) {
      // Update feature gates
      if (data.featureGates && response.results.featureGates) {
        data.featureGates.forEach((gate, index) => {
          if (gate.status === "pending") {
            const result = response.results.featureGates[index];
            if (result) {
              gate.status = result.success ? "completed" : "failed";
              gate.error = result.error;
            }
          }
        });
      }

      // Update dynamic configs
      if (data.dynamicConfigs && response.results.dynamicConfigs) {
        data.dynamicConfigs.forEach((config, index) => {
          if (config.status === "pending") {
            const result = response.results.dynamicConfigs[index];
            if (result) {
              config.status = result.success ? "completed" : "failed";
              config.error = result.error;
            }
          }
        });
      }

      // Update layers
      if (data.layers && response.results.layers) {
        data.layers.forEach((layer, index) => {
          if (layer.status === "pending") {
            const result = response.results.layers[index];
            if (result) {
              layer.status = result.success ? "completed" : "failed";
              layer.error = result.error;
            }
          }
        });
      }

      // Update experiments
      if (data.experiments && response.results.experiments) {
        data.experiments.forEach((exp, index) => {
          if (exp.status === "pending") {
            const result = response.results.experiments[index];
            if (result) {
              exp.status = result.success ? "completed" : "failed";
              exp.error = result.error;
            }
          }
        });
      }

      // Update segments
      if (data.segments && response.results.segments) {
        data.segments.forEach((segment, index) => {
          if (segment.status === "pending") {
            const result = response.results.segments[index];
            if (result) {
              segment.status = result.success ? "completed" : "failed";
              segment.error = result.error;
            }
          }
        });
      }

      // Update metrics
      if (data.metrics && response.results.metrics) {
        data.metrics.forEach((metric, index) => {
          if (metric.status === "pending") {
            const result = response.results.metrics[index];
            if (result) {
              metric.status = result.success ? "completed" : "failed";
              metric.error = result.error;
            }
          }
        });
      }
    } else {
      console.error("Unexpected response structure:", response);
      // Mark all pending items as failed due to unexpected response
      data.featureGates?.forEach(gate => {
        if (gate.status === "pending") {
          gate.status = "failed";
          gate.error = "Unexpected response from server";
        }
      });
      data.dynamicConfigs?.forEach(config => {
        if (config.status === "pending") {
          config.status = "failed";
          config.error = "Unexpected response from server";
        }
      });
      data.layers?.forEach(layer => {
        if (layer.status === "pending") {
          layer.status = "failed";
          layer.error = "Unexpected response from server";
        }
      });
      data.experiments?.forEach(exp => {
        if (exp.status === "pending") {
          exp.status = "failed";
          exp.error = "Unexpected response from server";
        }
      });
      data.segments?.forEach(segment => {
        if (segment.status === "pending") {
          segment.status = "failed";
          segment.error = "Unexpected response from server";
        }
      });
      data.metrics?.forEach(metric => {
        if (metric.status === "pending") {
          metric.status = "failed";
          metric.error = "Unexpected response from server";
        }
      });
    }

    data.status = "completed";
    callback(data);
  } catch (error) {
    // Mark all pending items as failed
    data.featureGates?.forEach(gate => {
      if (gate.status === "pending") {
        gate.status = "failed";
        gate.error = error.message || "Import failed";
      }
    });
    data.dynamicConfigs?.forEach(config => {
      if (config.status === "pending") {
        config.status = "failed";
        config.error = error.message || "Import failed";
      }
    });
    data.layers?.forEach(layer => {
      if (layer.status === "pending") {
        layer.status = "failed";
        layer.error = error.message || "Import failed";
      }
    });
    data.experiments?.forEach(exp => {
      if (exp.status === "pending") {
        exp.status = "failed";
        exp.error = error.message || "Import failed";
      }
    });
    data.segments?.forEach(segment => {
      if (segment.status === "pending") {
        segment.status = "failed";
        segment.error = error.message || "Import failed";
      }
    });
    data.metrics?.forEach(metric => {
      if (metric.status === "pending") {
        metric.status = "failed";
        metric.error = error.message || "Import failed";
      }
    });

    data.status = "completed";
    callback(data);
  }
}

function ImportStatusDisplay({
  data,
  itemType,
  itemId,
}: {
  data: {
    status: ImportStatus;
    error?: string;
  };
  itemType?: string;
  itemId?: string;
}) {
  const color = ["failed", "invalid"].includes(data.status)
    ? "danger"
    : data.status === "completed"
      ? "success"
      : data.status === "skipped"
        ? "secondary"
        : "purple";

  const getItemUrl = (type: string, id: string) => {
    switch (type) {
      case "metric":
        return `/metrics/${id}`;
      case "experiment":
        return `/experiment/${id}`;
      case "segment":
        return `/segments/${id}`;
      case "feature":
        return `/features/${id}`;
      default:
        return null;
    }
  };

  const url = itemType && itemId ? getItemUrl(itemType, itemId) : null;
  console.log("Generated URL for", itemType, itemId, ":", url);

  return (
    <div className="d-flex align-items-center">
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
    {url && data.status === "completed" && (
      <a 
        href={url} 
        target="_blank" 
        rel="noopener noreferrer"
        className="btn btn-sm btn-outline-primary ml-2"
        title={`View ${itemType}`}
      >
        View
      </a>
    )}
  </div>
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

  const { features, mutate: mutateFeatures } = useFeaturesList(false);
  const { mutateDefinitions } = useDefinitions();
  const environments = useEnvironments();
  const { refreshOrganization } = useUser();

  const existingEnvironments = useMemo(
    () => new Set(environments.map((e) => e.id)),
    [environments],
  );
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
            {data.featureGates ? (
              <div className="appbox mb-4">
                <ImportHeader name="Feature Gates" items={data.featureGates} />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-auto">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Name</th>
                          <th>Description</th>
                          <th>Enabled</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.featureGates?.map((gate, i) => (
                          <tr key={i}>
                            <td>
                              <ImportStatusDisplay 
                                data={gate} 
                                itemType="feature"
                                itemId={gate.featureGate?.id}
                              />
                            </td>
                            <td>{gate.featureGate?.name}</td>
                            <td>{gate.featureGate?.description}</td>
                            <td>{gate.featureGate?.isEnabled ? "Yes" : "No"}</td>
                            <td>
                              <em>{gate.error}</em>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
            {data.dynamicConfigs ? (
              <div className="appbox mb-4">
                <ImportHeader name="Dynamic Configs" items={data.dynamicConfigs} />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-auto">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Name</th>
                          <th>Description</th>
                          <th>Default Value</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.dynamicConfigs?.map((config, i) => (
                          <tr key={i}>
                            <td>
                              <ImportStatusDisplay 
                                data={config} 
                                itemType="feature"
                                itemId={config.dynamicConfig?.id}
                              />
                            </td>
                            <td>{config.dynamicConfig?.name}</td>
                            <td>{config.dynamicConfig?.description}</td>
                            <td>
                              <Code
                                language="json"
                                code={JSON.stringify(config.dynamicConfig?.default_value, null, 2)}
                              />
                            </td>
                            <td>
                              <em>{config.error}</em>
                            </td>
                          </tr>
                        ))}
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
                    <table className="gbtable table w-auto">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Name</th>
                          <th>Status</th>
                          <th>Primary Metric</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.experiments?.map((exp, i) => {
                          console.log("Experiment data:", exp);
                          console.log("Experiment object:", exp.experiment);
                          console.log("Experiment ID:", exp.experiment?.id);
                          console.log("Experiment trackingKey:", exp.experiment?.trackingKey);
                          // Use trackingKey if available, otherwise fall back to id
                          const experimentId = exp.experiment?.id;
                          return (
                            <tr key={i}>
                              <td>
                                <ImportStatusDisplay 
                                  data={exp} 
                                  itemType="experiment"
                                  itemId={experimentId}
                                />
                              </td>
                              <td>{exp.experiment?.name}</td>
                              <td>{exp.experiment?.status}</td>
                              <td>{exp.experiment?.primary_metric}</td>
                              <td>
                                <em>{exp.error}</em>
                              </td>
                            </tr>
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
                    <table className="gbtable table w-auto">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Description</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.segments?.map((segment, i) => (
                          <tr key={i}>
                            <td>
                              <ImportStatusDisplay 
                                data={segment} 
                                itemType="segment"
                                itemId={segment.segment?.id}
                              />
                            </td>
                            <td>{segment.segment?.name}</td>
                            <td>{segment.segment?.type}</td>
                            <td>{segment.segment?.description}</td>
                            <td>
                              <em>{segment.error}</em>
                            </td>
                          </tr>
                        ))}
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
                    <table className="gbtable table w-auto">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Name</th>
                          <th>Description</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.layers?.map((layer, i) => (
                          <tr key={i}>
                            <td>
                              <ImportStatusDisplay 
                                data={layer} 
                                itemType="feature"
                                itemId={layer.layer?.id}
                              />
                            </td>
                            <td>{layer.layer?.name || layer.layer?.id}</td>
                            <td>{layer.layer?.description}</td>
                            <td>
                              <em>{layer.error}</em>
                            </td>
                          </tr>
                        ))}
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
                    <table className="gbtable table w-auto">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Description</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.metrics?.map((metric, i) => (
                          <tr key={i}>
                            <td>
                              <ImportStatusDisplay 
                                data={metric} 
                                itemType="metric"
                                itemId={metric.metric?.id}
                              />
                            </td>
                            <td>{metric.metric?.name || metric.metric?.id}</td>
                            <td>{metric.metric?.type}</td>
                            <td>{metric.metric?.description}</td>
                            <td>
                              <em>{metric.error}</em>
                            </td>
                          </tr>
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
