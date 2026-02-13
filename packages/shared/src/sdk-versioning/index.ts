import lodash from "lodash";
const { uniq } = lodash;
import { paddedVersionString } from "@growthbook/growthbook";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import { CapabilityStrategy, SDKCapability } from "./types.js";

// Generated from sdk-versions/*.json - bundle-friendly (no node:module)
import {
  nocode_json,
  javascript_json,
  nodejs_json,
  nextjs_json,
  react_json,
  php_json,
  python_json,
  ruby_json,
  java_json,
  kotlin_json,
  swift_json,
  go_json,
  flutter_json,
  csharp_json,
  elixir_json,
  edge_cloudflare_json,
  edge_fastly_json,
  edge_lambda_json,
  edge_other_json,
  rust_json,
  roku_json,
  other_json,
} from "./sdk-versions-data.generated.js";

type SDKRecords = Record<SDKLanguage, SDKData>;
type SDKData = {
  versions: readonly SDKVersionData[];
};
type SDKVersionData = {
  version: string;
  capabilities?: readonly string[];
};

export const sdks: SDKRecords = {
  "nocode-other": nocode_json,
  "nocode-webflow": nocode_json,
  "nocode-shopify": nocode_json,
  "nocode-wordpress": nocode_json,
  javascript: javascript_json,
  nodejs: nodejs_json,
  nextjs: nextjs_json,
  react: react_json,
  php: php_json,
  python: python_json,
  ruby: ruby_json,
  java: java_json,
  android: kotlin_json,
  ios: swift_json,
  go: go_json,
  flutter: flutter_json,
  csharp: csharp_json,
  elixir: elixir_json,
  rust: rust_json,
  roku: roku_json,
  "edge-cloudflare": edge_cloudflare_json,
  "edge-fastly": edge_fastly_json,
  "edge-lambda": edge_lambda_json,
  "edge-other": edge_other_json,
  other: other_json,
};

// Default SDK versions as of 12/5/2023
// DO NOT UPDATE. Used to migrate SDK connections created before we started storing versions
const defaultSdkVersions: Record<SDKLanguage, string> = {
  "nocode-other": "0.0.0",
  "nocode-webflow": "0.0.0",
  "nocode-shopify": "0.0.0",
  "nocode-wordpress": "0.0.0",
  javascript: "0.31.0",
  nodejs: "0.31.0",
  nextjs: "1.0.0",
  react: "0.21.0",
  php: "1.2.0",
  python: "1.0.0",
  ruby: "1.2.2",
  java: "0.9.0",
  android: "1.1.43",
  ios: "1.0.44",
  go: "0.1.4",
  flutter: "1.1.2",
  csharp: "0.2.0",
  elixir: "0.2.0",
  "edge-cloudflare": "0.1.10",
  "edge-fastly": "0.1.4",
  "edge-lambda": "0.0.5",
  "edge-other": "0.1.3",
  rust: "0.0.4",
  roku: "1.3.1",
  other: "0.0.0",
};

const getSdkData = (language: SDKLanguage = "other"): SDKData => {
  let sdkData: SDKData = sdks[language];
  if (!sdkData) {
    sdkData = sdks["other"];
  }
  return sdkData;
};

export const getSDKVersions = (language: SDKLanguage = "other"): string[] => {
  const sdkData = getSdkData(language);
  const versions = sdkData?.versions || [];
  return versions.map((v) => v.version);
};

export const getLatestSDKVersion = (
  language: SDKLanguage = "other",
): string => {
  const sdkData = getSdkData(language);
  const versions = sdkData?.versions || [];
  const current = versions?.[0];
  return current?.version || "0.0.0";
};

export const getDefaultSDKVersion = (
  language: SDKLanguage = "other",
): string => {
  return defaultSdkVersions[language] || "0.0.0";
};

export const isSDKOutdated = (
  language: SDKLanguage = "other",
  version?: string,
): boolean => {
  version = version || getDefaultSDKVersion(language);
  const current = getLatestSDKVersion(language);
  return paddedVersionString(version) < paddedVersionString(current);
};

export const getSDKCapabilities = (
  language: SDKLanguage = "other",
  version?: string,
  expandLooseUnmashalling?: boolean,
): SDKCapability[] => {
  language = language || "other";

  version = version || getDefaultSDKVersion(language);
  const sdkData = getSdkData(language);
  const versions = sdkData?.versions || [];
  const matches = versions.filter(
    (data) => paddedVersionString(data.version) <= paddedVersionString(version),
  );
  const capabilities = matches.reduce(
    (acc, data) => [...acc, ...(data?.capabilities ?? [])],
    [],
  );
  if (expandLooseUnmashalling && capabilities.includes("looseUnmarshalling")) {
    capabilities.push("bucketingV2");
  }
  return uniq(capabilities) as SDKCapability[];
};

// Typically works the same as getCapabilities. However, if the connection has multiple languages, assume the
// minimal-allowed SDK Version (0.0.0), and return the intersection of capabilities between all languages.
export const getConnectionSDKCapabilities = (
  connection: Partial<SDKConnectionInterface>,
  strategy: CapabilityStrategy = "min-ver-intersection-loose-unmarshalling",
) => {
  if ((connection?.languages?.length || 0) <= 1) {
    return getSDKCapabilities(
      connection.languages?.[0],
      [
        "min-ver-intersection",
        "min-ver-intersection-loose-unmarshalling",
      ].includes(strategy)
        ? connection.sdkVersion
        : getLatestSDKVersion(connection.languages?.[0]),
    );
  }
  let capabilities: SDKCapability[] = [];
  let i = 0;
  for (const language of connection.languages || []) {
    const languageCapabilities = getSDKCapabilities(
      language,
      [
        "min-ver-intersection",
        "min-ver-intersection-loose-unmarshalling",
      ].includes(strategy)
        ? undefined
        : getLatestSDKVersion(language),
      strategy === "min-ver-intersection-loose-unmarshalling",
    );
    if (i === 0) {
      capabilities = languageCapabilities;
    } else {
      capabilities = capabilities.filter((c) =>
        languageCapabilities.includes(c),
      );
    }
    i++;
  }
  return uniq(capabilities);
};

export const getConnectionsSDKCapabilities = ({
  connections,
  strategy = "min-ver-intersection",
  mustMatchAllConnections = false,
  project,
}: {
  connections: Partial<SDKConnectionInterface>[];
  strategy?: "min-ver-intersection" | "max-ver-intersection";
  mustMatchAllConnections?: boolean;
  project?: string;
}) => {
  let capabilities: SDKCapability[] = [];
  const filteredConnections = connections.filter((c) => {
    if (project === undefined) return true;
    return c.projects?.includes(project) || (c.projects ?? [])?.length === 0;
  });
  for (let i = 0; i < filteredConnections.length; i++) {
    const connection = filteredConnections[i];
    const connectionCapabilities = getConnectionSDKCapabilities(
      connection,
      strategy,
    );
    if (!mustMatchAllConnections || i === 0) {
      capabilities = capabilities.concat(connectionCapabilities);
    } else {
      capabilities = capabilities.filter((c) =>
        connectionCapabilities.includes(c),
      );
    }
  }
  return uniq(capabilities);
};

export const getSDKCapabilityVersion = (
  language: SDKLanguage = "other",
  capability: SDKCapability,
): string | null => {
  const sdkData = getSdkData(language);
  const versions = sdkData?.versions || [];
  for (let i = versions.length - 1; i >= 0; i--) {
    const data = versions[i];
    if (data.capabilities?.includes(capability)) {
      return data.version;
    }
  }
  return null;
};

export type MinSupportedSDKVersions = {
  language: SDKLanguage;
  minVersion: string;
};
export function getMinSupportedSDKVersions(
  capability: SDKCapability,
): MinSupportedSDKVersions[] {
  const languages = Object.keys(sdks) as SDKLanguage[];
  const matches: MinSupportedSDKVersions[] = [];
  languages.forEach((language) => {
    const minVersion = getSDKCapabilityVersion(language, capability);

    if (minVersion) {
      matches.push({ language, minVersion });
    }
  });
  return matches;
}

export * from "./types.js";
export * from "./sdk-payload.js";
