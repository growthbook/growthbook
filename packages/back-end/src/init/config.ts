import { env } from "string-env-interpolation";
import yaml from "js-yaml";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { IS_CLOUD } from "../util/secrets";
import { DataSourceInterfaceWithParams } from "../../types/datasource";
import { MetricInterface } from "../../types/metric";
import { DimensionInterface } from "../../types/dimension";

type ConfigFile = {
  organization?: {
    name: string;
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

const CONFIG_FILE = path.join(__dirname, "..", "..", "..", "..", "config.yml");

let config: ConfigFile;

if (!IS_CLOUD && existsSync(CONFIG_FILE)) {
  const contents = env(readFileSync(CONFIG_FILE, "utf-8"));
  const parsed = yaml.load(contents, {
    filename: CONFIG_FILE,
  });
  if (typeof parsed === "number" || typeof parsed === "string") {
    throw new Error("Invalid config.yml file");
  }

  config = parsed;
} else {
  if (!IS_CLOUD) {
    console.log("No config.yml file, using MongoDB instead");
  }
}

export function getConfig() {
  return config || {};
}
