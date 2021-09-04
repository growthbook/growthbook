import { env } from "string-env-interpolation";
import yaml from "js-yaml";
import { readFileSync, existsSync, statSync } from "fs";
import path from "path";
import { ENVIRONMENT, IS_CLOUD } from "../util/secrets";
import {
  DataSourceInterface,
  DataSourceInterfaceWithParams,
} from "../../types/datasource";
import { MetricInterface } from "../../types/metric";
import { DimensionInterface } from "../../types/dimension";
import { encryptParams } from "../services/datasource";
import { OrganizationSettings } from "../../types/organization";

type ConfigFile = {
  organization?: {
    settings: OrganizationSettings;
  };
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

let configFileTime: number;
let config: ConfigFile;

function loadConfig(initial = false) {
  if (IS_CLOUD) return;

  if (existsSync(CONFIG_FILE)) {
    // Only reload if the modified time has changed
    const newFileTime = statSync(CONFIG_FILE).mtimeMs;
    if (newFileTime === configFileTime) return;
    configFileTime = newFileTime;

    const contents = env(readFileSync(CONFIG_FILE, "utf-8"));
    const parsed = yaml.load(contents, {
      filename: CONFIG_FILE,
    });

    // Validate that the yml file is in the correct format
    if (typeof parsed === "number" || typeof parsed === "string") {
      throw new Error("Invalid config.yml file");
    }
    // TODO: more validation

    // Store the parsed config
    config = parsed as ConfigFile;
  } else if (ENVIRONMENT !== "production") {
    config = null;
    if (initial) {
      console.log(
        "No config.yml file. Using MongoDB instead to store data sources, metrics, and dimensions."
      );
    }
  }
}
loadConfig(true);

function reloadConfigIfNeeded() {
  // Don't reload config.yml on production at all
  // Require a server restart to pick up changes instead
  if (ENVIRONMENT === "production" || IS_CLOUD) return;

  loadConfig();
}

export function usingFileConfig(): boolean {
  reloadConfigIfNeeded();
  return !!config;
}

export function getConfigDatasources(
  organization: string
): DataSourceInterface[] {
  reloadConfigIfNeeded();
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
  reloadConfigIfNeeded();
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
  reloadConfigIfNeeded();
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

export function getConfigOrganizationSettings(): OrganizationSettings {
  reloadConfigIfNeeded();
  return config?.organization?.settings || {};
}
