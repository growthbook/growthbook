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
  autoSliceUpdateFrequencyHours: 168, // Default: 7 days
  hasOpenAIKey: false,
  hasAnthropicKey: false,
  hasXaiKey: false,
  hasMistralKey: false,
  hasGoogleAIKey: false,
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

export function hasAnthropicKey() {
  return env.hasAnthropicKey || false;
}

export function hasXaiKey() {
  return env.hasXaiKey || false;
}

export function hasMistralKey() {
  return env.hasMistralKey || false;
}

export function hasGoogleAIKey() {
  return env.hasGoogleAIKey || false;
}

export function getExperimentRefreshFrequency() {
  return env.experimentRefreshFrequency;
}

export function getAutoSliceUpdateFrequencyHours() {
  return env.autoSliceUpdateFrequencyHours;
}

export function getUploadMethod(): "local" | "s3" | "google-cloud" {
  return env.uploadMethod;
}

/** True when file uploads are configured (local storage, or S3/GCS with domain set) */
export function hasUploadSupport(): boolean {
  const method = env.uploadMethod;
  if (method === "local") return true;
  if (method === "s3") return !!env.s3domain;
  if (method === "google-cloud") return !!env.gcsDomain;
  return false;
}
