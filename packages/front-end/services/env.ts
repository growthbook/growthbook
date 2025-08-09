import * as Sentry from "@sentry/nextjs";
import { EnvironmentInitValue } from "@/./pages/api/init";

const env: EnvironmentInitValue = {
  telemetry: "disable",
  cloud: false,
  isMultiOrg: false,
  allowSelfOrgCreation: false,
  showMultiOrgSelfSelector: true,
  appOrigin: "",
  apiHost: "",
  environment: "",
  s3domain: "",
  gcsDomain: "",
  cdnHost: "",
  config: "db",
  defaultConversionWindowHours: 72,
  sentryDSN: "",
  usingSSO: false,
  storeSegmentsInMongo: false,
  allowCreateMetrics: true,
  allowCreateDimensions: true,
  superadminDefaultRole: "readonly",
  ingestorOverride: "",
  stripePublishableKey: "",
  experimentRefreshFrequency: 6,
  hasOpenAIKey: false,
  hasOllamaServer: false,
  uploadMethod: "local",
};

export async function initEnv() {
  const res = await fetch("/api/init");
  const json = await res.json();
  Object.assign(env, json);

  if (env.sentryDSN) {
    Sentry.init({
      dsn: env.sentryDSN,
      sendDefaultPii: true,
      environment: env.environment,
      release: env.build?.sha,
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
  return env.telemetry === "enable" || env.telemetry === "enable-with-debug";
}
export function inTelemetryDebugMode(): boolean {
  return env.telemetry === "debug" || env.telemetry === "enable-with-debug";
}
export function hasFileConfig() {
  return env.config === "file";
}
export function envAllowsCreatingMetrics() {
  return env.allowCreateMetrics;
}
export function envAllowsCreatingDimensions() {
  return env.allowCreateDimensions;
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
export function getSuperadminDefaultRole() {
  return env.superadminDefaultRole;
}
export function getIngestorHost() {
  return env.ingestorOverride || "https://us1.gb-ingest.com";
}

export function getStripePublishableKey() {
  return env.stripePublishableKey;
}
export function hasOpenAIKey() {
  return env.hasOpenAIKey || false;
}
export function hasOllamaServer() {
  return env.hasOllamaServer || false;
}

export function getExperimentRefreshFrequency() {
  return env.experimentRefreshFrequency;
}

export function getUploadMethod(): "local" | "s3" | "google-cloud" {
  return env.uploadMethod;
}
