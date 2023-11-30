import { SDKLanguage } from "back-end/types/sdk-connection";
import * as sdksJson from "./sdks.json";

type SDKRecords = Record<SDKLanguage, SDKVersionData[] | string>;
type SDKVersionData = {
  version: string;
  capabilities?: string[];
};
const sdks: SDKRecords = sdksJson as SDKRecords;

export const getCurrentVersion = (language: SDKLanguage = "other") => {
  let sdkData = sdks[language];
  if (typeof sdkData === "string" && sdkData.charAt(0) === "@") {
    language = sdkData.slice(1) as SDKLanguage;
    sdkData = sdks[language];
  }
  if (!sdkData) {
    sdkData = sdks["other"];
  }
  const current = (sdkData as SDKVersionData[])?.pop();
  return current?.version || "0.0.0";
};
