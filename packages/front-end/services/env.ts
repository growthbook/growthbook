import * as Sentry from "@sentry/react";
import { EnvironmentInitValue } from "@/./pages/api/init";

const env: EnvironmentInitValue = {
  telemetry: "disable",
  cloud: false,
  isMultiOrg: false,
  allowSelfOrgCreation: false,
  showMultiOrgSelfSelector: true,
  appOrigin: "",
  apiHost: "",
  s3domain: "",
  gcsDomain: "",
  cdnHost: "",
  config: "db",
  defaultConversionWindowHours: 72,
  sentryDSN: "",
  usingSSO: false,
  storeSegmentsInMongo: false,
  allowCreateMetrics: true,
  usingFileProxy: false,
  superadminDefaultRole: "readonly",
};

export let dataWarehouseUrl;

export async function initEnv() {
  const res = await fetch("/api/init");
  const json = await res.json();
  Object.assign(env, json);

  dataWarehouseUrl = env.dataWarehouseUrl;

  if (env.sentryDSN) {
    Sentry.init({
      dsn: env.sentryDSN,
    });
  }
}

export function getAppOrigin(): string {
  return env.appOrigin;
}

export function getCdnHost(): string {
  return env.cdnHost;
}
export function getS3Domain(): string {
  return env.s3domain;
}
export function getGcsDomain(): string {
  return env.gcsDomain;
}
export function getApiHost(): string {
  return env.apiHost;
}
export function isCloud(): boolean {
  return env.cloud;
}
export function isMultiOrg(): boolean {
  return !!env.isMultiOrg;
}
export function allowSelfOrgCreation(): boolean {
  return env.allowSelfOrgCreation;
}
export function showMultiOrgSelfSelector(): boolean {
  return env.showMultiOrgSelfSelector;
}
export function isTelemetryEnabled(): boolean {
  return env.telemetry === "enable";
}
export function inTelemetryDebugMode(): boolean {
  return env.telemetry === "debug";
}
export function hasFileConfig() {
  return env.config === "file";
}
export function envAllowsCreatingMetrics() {
  return env.allowCreateMetrics;
}
export function getDefaultConversionWindowHours() {
  return env.defaultConversionWindowHours;
}
export function getGrowthBookBuild(): {
  sha: string;
  date: string;
  lastVersion: string;
} {
  return env.build || { sha: "", date: "", lastVersion: "" };
}
export function usingSSO() {
  return env.usingSSO;
}
export function isSentryEnabled() {
  return !!env.sentryDSN;
}
export function storeSegmentsInMongo() {
  return env.storeSegmentsInMongo;
}
export function usingFileProxy() {
  return env.usingFileProxy;
}
export function getSuperadminDefaultRole() {
  return env.superadminDefaultRole;
}
