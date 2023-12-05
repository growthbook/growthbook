import {
  SDKConnectionInterface,
  SDKLanguage,
} from "back-end/types/sdk-connection";
import uniq from "lodash/uniq";
import { SDKCapability } from "./types";

import * as javascript_json from "./sdk-versions/javascript.json";
import * as nodejs_json from "./sdk-versions/nodejs.json";
import * as react_json from "./sdk-versions/react.json";
import * as php_json from "./sdk-versions/php.json";
import * as python_json from "./sdk-versions/python.json";
import * as ruby_json from "./sdk-versions/ruby.json";
import * as java_json from "./sdk-versions/java.json";
import * as kotlin_json from "./sdk-versions/kotlin.json";
import * as swift_json from "./sdk-versions/swift.json";
import * as go_json from "./sdk-versions/go.json";
import * as flutter_json from "./sdk-versions/flutter.json";
import * as csharp_json from "./sdk-versions/csharp.json";
import * as other_json from "./sdk-versions/other.json";

type SDKRecords = Record<SDKLanguage, SDKData>;
type SDKData = {
  versions: SDKVersionData[];
};
type SDKVersionData = {
  version: string;
  capabilities?: string[];
};

const sdks: SDKRecords = {
  javascript: javascript_json,
  nodejs: nodejs_json,
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
  other: other_json,
};

const getSdkData = (language: SDKLanguage = "other"): SDKData => {
  let sdkData: SDKData = sdks[language];
  if (!sdkData) {
    sdkData = sdks["other"];
  }
  return sdkData;
};

export const getSDKVersions = (
  language: SDKLanguage = "other"
): string[] => {
  const sdkData = getSdkData(language);
  const versions = sdkData?.versions || [];
  return versions.map((v) => v.version);
};

export const getLatestSDKVersion = (
  language: SDKLanguage = "other"
): string => {
  const sdkData = getSdkData(language);
  const versions = sdkData?.versions || [];
  const current = versions?.[0];
  return current?.version || "0.0.0";
};

export const isSDKOutdated = (
  language: SDKLanguage = "other",
  version: string = "0.0.0"
): boolean => {
  const current = getLatestSDKVersion(language);
  return paddedVersionString(version) < paddedVersionString(current);
};

export const getSDKCapabilities = (
  language: SDKLanguage = "other",
  version: string = "0.0.0"
): SDKCapability[] => {
  language = language || "other";
  version = version && version !== "0" ? version : "0.0.0";
  const sdkData = getSdkData(language);
  const versions = sdkData?.versions || [];
  const matches = versions.filter(
    (data) => paddedVersionString(data.version) <= paddedVersionString(version)
  );
  const capabilities = matches.reduce(
    (acc, data) => [...acc, ...(data?.capabilities ?? [])],
    []
  );
  return uniq(capabilities) as SDKCapability[];
};

// Typically works the same as getCapabilities. However, if the connection has multiple languages, assume the
// minimal-allowed SDK Version (0.0.0), and return the intersection of capabilities between all languages.
export const getConnectionSDKCapabilities = (
  connection: Partial<SDKConnectionInterface>,
  strategy:
    | "min-ver-intersection"
    | "max-ver-intersection" = "min-ver-intersection"
) => {
  if ((connection?.languages?.length || 0) <= 1) {
    return getSDKCapabilities(
      connection.languages?.[0],
      strategy === "min-ver-intersection"
        ? connection.sdkVersion
        : getLatestSDKVersion(connection.languages?.[0])
    );
  }
  let capabilities: SDKCapability[] = [];
  let i = 0;
  for (const language of connection.languages || []) {
    const languageCapabilities = getSDKCapabilities(
      language,
      strategy === "min-ver-intersection"
        ? undefined
        : getLatestSDKVersion(language)
    );
    if (i === 0) {
      capabilities = languageCapabilities;
    } else {
      capabilities = capabilities.filter((c) =>
        languageCapabilities.includes(c)
      );
    }
    i++;
  }
  return uniq(capabilities);
};

export const getSDKCapabilityVersion = (
  language: SDKLanguage = "other",
  capability: SDKCapability
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

// Copied from the JS SDK's mongrule.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function paddedVersionString(input: any): string {
  if (typeof input === "number") {
    input = input + "";
  }
  if (!input || typeof input !== "string") {
    input = "0";
  }
  // Remove build info and leading `v` if any
  // Split version into parts (both core version numbers and pre-release tags)
  // "v1.2.3-rc.1+build123" -> ["1","2","3","rc","1"]
  const parts = (input as string).replace(/(^v|\+.*$)/g, "").split(/[-.]/);

  // If it's SemVer without a pre-release, add `~` to the end
  // ["1","0","0"] -> ["1","0","0","~"]
  // "~" is the largest ASCII character, so this will make "1.0.0" greater than "1.0.0-beta" for example
  if (parts.length === 3) {
    parts.push("~");
  }

  // Left pad each numeric part with spaces so string comparisons will work ("9">"10", but " 9"<"10")
  // Then, join back together into a single string
  return parts
    .map((v) => (v.match(/^[0-9]+$/) ? v.padStart(5, " ") : v))
    .join("-");
}

export * from "./types";
export * from "./sdk-payload";
