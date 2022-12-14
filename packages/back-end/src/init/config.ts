import { readFileSync, existsSync, statSync } from "fs";
import path from "path";
import { env } from "string-env-interpolation";
import yaml from "js-yaml";
import {
  EMAIL_ENABLED,
  ENVIRONMENT,
  IS_CLOUD,
  EMAIL_FROM,
  EMAIL_HOST,
  EMAIL_HOST_PASSWORD,
  EMAIL_HOST_USER,
  EMAIL_PORT,
} from "../util/secrets";
import {
  DataSourceInterface,
  DataSourceInterfaceWithParams,
} from "../../types/datasource";
import { MetricInterface } from "../../types/metric";
import { DimensionInterface } from "../../types/dimension";
import { encryptParams } from "../services/datasource";
import { OrganizationSettings } from "../../types/organization";
import { upgradeMetricDoc, upgradeDatasourceObject } from "../util/migrations";
import { logger } from "../util/logger";

export type ConfigFile = {
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
let config: ConfigFile | null = null;

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
      logger.info(
        "No config.yml file. Using MongoDB instead to store data sources, metrics, and dimensions."
      );
    }
  }

  if (EMAIL_ENABLED) {
    if (!EMAIL_HOST)
      logger.error(
        "Email is enabled, but missing required EMAIL_HOST env variable"
      );
    if (!EMAIL_PORT)
      logger.error(
        "Email is enabled, but missing required EMAIL_PORT env variable"
      );
    if (!EMAIL_HOST_USER)
      logger.error(
        "Email is enabled, but missing required EMAIL_HOST_USER env variable"
      );
    if (!EMAIL_HOST_PASSWORD)
      logger.error(
        "Email is enabled, but missing required EMAIL_HOST_PASSWORD env variable"
      );
    if (!EMAIL_FROM)
      logger.error(
        "Email is enabled, but missing required EMAIL_FROM env variable"
      );
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
  const datasources = config.datasources;

  return Object.keys(datasources).map((id) => {
    const d = datasources[id];

    return upgradeDatasourceObject({
      id,
      name: d.name,
      description: d.description,
      organization,
      params: encryptParams(d.params),
      settings: d.settings,
      type: d.type,
      dateCreated: null,
      dateUpdated: null,
    });
  });
}

export function getConfigMetrics(organization: string): MetricInterface[] {
  reloadConfigIfNeeded();
  if (!config || !config.metrics) return [];
  const metrics = config.metrics;

  return Object.keys(metrics).map((id) => {
    const m = metrics[id];

    return upgradeMetricDoc({
      tags: [],
      id,
      ...m,
      description: m?.description || "",
      organization,
      dateCreated: null,
      dateUpdated: null,
      queries: [],
      runStarted: null,
    });
  });
}

export function getConfigDimensions(
  organization: string
): DimensionInterface[] {
  reloadConfigIfNeeded();
  if (!config || !config.dimensions) return [];
  const dimensions = config.dimensions;

  return Object.keys(dimensions).map((id) => {
    const d = dimensions[id];

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
