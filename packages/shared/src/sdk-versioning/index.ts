import { SDKLanguage } from "back-end/types/sdk-connection";
import uniq from "lodash/uniq";
import * as sdksJson from "./sdks.json";

export type SDKCapability = "loose-unmarshalling" | "remote-evaluation";

type SDKRecords = Record<SDKLanguage, SDKData>;
type SDKData = {
  versions?: SDKVersionData[];
  alias?: string;
  capabilities?: string[];
  removeCapabilities?: string[];
};
type SDKVersionData = {
  version: string;
  capabilities?: string[];
};
const sdks: SDKRecords = sdksJson as SDKRecords;

const getSdkData = (language: SDKLanguage = "other"): SDKData => {
  let sdkData: SDKData = { ...sdks[language] };
  if (sdkData?.alias && sdks?.[sdkData.alias as SDKLanguage]) {
    sdkData = { ...sdks[sdkData.alias as SDKLanguage], ...sdkData };
  }
  if (!sdkData) {
    sdkData = sdks["other"];
  }
  return sdkData;
};

export const getCurrentVersion = (language: SDKLanguage = "other"): string => {
  const sdkData = getSdkData(language);
  const versions = sdkData?.versions || [];
  const current = versions?.[0];
  return current?.version || "0.0.0";
};

export const getCapabilities = (
  language: SDKLanguage = "other",
  version: string = "0.0.0"
): SDKCapability[] => {
  version = version || "0.0.0";
  const sdkData = getSdkData(language);
  const versions = sdkData?.versions || [];
  const matches = versions.filter(
    (data) => paddedVersionString(data.version) <= paddedVersionString(version)
  );
  let capabilities = matches.reduce(
    (acc, data) => [...acc, ...(data?.capabilities ?? [])],
    []
  );
  capabilities = [...capabilities, ...(sdkData?.capabilities ?? [])];
  capabilities = capabilities.filter(
    (c) => !(sdkData?.removeCapabilities ?? []).includes(c)
  );
  return uniq(capabilities) as SDKCapability[];
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

export * from "./sdk-payload";
