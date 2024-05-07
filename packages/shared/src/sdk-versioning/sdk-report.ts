import fs from "fs";
import uniq from "lodash/uniq";
import difference from "lodash/difference";

import { SDKLanguage } from "back-end/types/sdk-connection";
import {
  getDefaultSDKVersion,
  getLatestSDKVersion,
  getSDKCapabilities,
} from ".";

const languages = [
  "javascript",
  "nodejs",
  "react",
  "php",
  "python",
  "ruby",
  "java",
  "android",
  "ios",
  "go",
  "flutter",
  "csharp",
  "elixir",
  "nocode-other",
  "nocode-webflow",
  "nocode-shopify",
  "nocode-wordpress",
];

type Info = {
  versions: Record<string, string>;
  capabilities: string[];
};

const versionKey = (lang: string, capability: string) =>
  lang + "__" + capability;

function getInfo(languages: string[]): Info {
  const info = {
    versions: {},
    capabilities: [],
  };
  languages.forEach((lang) => updateInfo(lang, info));
  info.capabilities = uniq(info.capabilities);
  return info;
}

function updateInfo(lang: string, { versions, capabilities }: Info) {
  const sdkLang = lang as SDKLanguage;
  const defaultVersion = getDefaultSDKVersion(sdkLang);
  const latestVersion = getLatestSDKVersion(sdkLang);
  const defaultCaps = getSDKCapabilities(sdkLang, defaultVersion);
  const latestCaps = difference(
    getSDKCapabilities(sdkLang, latestVersion),
    defaultCaps,
  );
  defaultCaps.forEach(
    (cap) => (versions[versionKey(lang, cap)] = defaultVersion),
  );
  latestCaps.forEach(
    (cap) => (versions[versionKey(lang, cap)] = latestVersion),
  );
  capabilities.push(...defaultCaps);
  capabilities.push(...latestCaps);
}

function captable(languages: string[]) {
  const defaultVersions = languages.map((lang) =>
    getDefaultSDKVersion(lang as SDKLanguage),
  );
  const latestVersions = languages.map((lang) =>
    getLatestSDKVersion(lang as SDKLanguage),
  );
  const info = getInfo(languages);
  const capsRows = info.capabilities.map((capability) => {
    const langVersions = languages.map(
      (lang) => info.versions[versionKey(lang, capability)] || "",
    );
    return [capability, ...langVersions];
  });
  const captable = [
    ["SDK", ...languages],
    ["**Default**", ...defaultVersions],
    ["**Latest**", ...latestVersions],
    ["**Capabilities**"],
    ...capsRows,
  ];
  return captable;
}

function renderTable(rows: string[][]) {
  const firstRow = rows.shift() || [""];
  const table =
    "\n" +
    firstRow.join(" | ") +
    "\n" +
    firstRow.map((_) => "---").join(" | ") +
    "\n" +
    rows.map((row) => row.join(" | ")).join("\n");
  return table;
}

const report = () => {
  return [
    "### List of SDKs and capabilities",
    "",
    renderTable(captable(languages)),
  ].join("\n");
};

function main() {
  const path = process.argv[2];
  if (path) {
    // eslint-disable-next-line no-console
    console.log("Saving to file", path);
    fs.writeFileSync(path, report());
  } else {
    // eslint-disable-next-line no-console
    console.log("Please provide file path");
    process.exit(1);
  }
}

main();
