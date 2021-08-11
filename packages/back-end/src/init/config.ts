import { env } from "string-env-interpolation";
import yaml from "js-yaml";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { IS_CLOUD } from "../util/secrets";
import {
  DataSourceInterface,
  DataSourceInterfaceWithParams,
} from "../../types/datasource";
import { MetricInterface } from "../../types/metric";
import { DimensionInterface } from "../../types/dimension";
import { encryptParams } from "../services/datasource";

type ConfigFile = {
  datasources?: {
    [key: string]: Omit<
      DataSourceInterfaceWithParams,
      "id" | "organization" | "dateCreated" | "dateUpdated"
    >;
  };
  metrics?: {
    [key: string]: Omit<
      MetricInterface,
      | "id"
      | "organization"
      | "queries"
      | "runStarted"
      | "analysis"
      | "dateCreated"
      | "dateUpdated"
    >;
  };
  dimensions?: {
    [key: string]: Omit<
      DimensionInterface,
      "id" | "organization" | "dateCreated" | "dateUpdated"
    >;
  };
};

const CONFIG_FILE = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "config",
  "config.yml"
);

let config: ConfigFile;

if (!IS_CLOUD && existsSync(CONFIG_FILE)) {
  const contents = env(readFileSync(CONFIG_FILE, "utf-8"));
  const parsed = yaml.load(contents, {
    filename: CONFIG_FILE,
  });
  if (typeof parsed === "number" || typeof parsed === "string") {
    throw new Error("Invalid config.yml file");
  }

  // TODO: validation

  config = parsed as ConfigFile;
} else {
  if (!IS_CLOUD) {
    console.log(
      "No config/config.yml file. Using MongoDB instead to store data sources, metrics, and dimensions."
    );
  }
}

export function usingFileConfig(): boolean {
  return !!config;
}

export function getConfigDatasources(
  organization: string
): DataSourceInterface[] {
  if (!config || !config.datasources) return [];

  return Object.keys(config.datasources).map((id) => {
    const d = config.datasources[id];

    return {
      id,
      name: d.name,
      organization,
      params: encryptParams(d.params),
      settings: d.settings,
      type: d.type,
      dateCreated: null,
      dateUpdated: null,
    };
  });
}

export function getConfigMetrics(organization: string): MetricInterface[] {
  if (!config || !config.metrics) return [];

  return Object.keys(config.metrics).map((id) => {
    const m = config.metrics[id];

    return {
      tags: [],
      description: "",
      id,
      ...m,
      organization,
      dateCreated: null,
      dateUpdated: null,
      queries: [],
      runStarted: null,
    };
  });
}

export function getConfigDimensions(
  organization: string
): DimensionInterface[] {
  if (!config || !config.dimensions) return [];

  return Object.keys(config.dimensions).map((id) => {
    const d = config.dimensions[id];

    return {
      id,
      ...d,
      organization,
      dateCreated: null,
      dateUpdated: null,
    };
  });
}
