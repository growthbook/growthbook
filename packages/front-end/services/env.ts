import * as Sentry from "@sentry/react";
import { EnvironmentInitValue } from "../pages/api/init";

const env: EnvironmentInitValue = {
  telemetry: "enable",
  cloud: false,
  appOrigin: "",
  apiHost: "",
  cdnHost: "",
  config: "db",
  defaultConversionWindowHours: 72,
  sentryDSN: "",
  usingSSO: false,
};

export async function initEnv() {
  const res = await fetch("/api/init");
  const json = await res.json();
  Object.assign(env, json);

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

export function getApiHost(): string {
  return env.apiHost;
}
export function isCloud(): boolean {
  return env.cloud;
}
export function isTelemetryEnabled() {
  return env.telemetry === "enable";
}
export function inTelemetryDebugMode(): boolean {
  return env.telemetry === "debug";
}
export function hasFileConfig() {
  return env.config === "file";
}
export function getDefaultConversionWindowHours() {
  return env.defaultConversionWindowHours;
}
export function getGrowthBookBuild(): { sha: string; date: string } {
  return env.build || { sha: "", date: "" };
}
export function usingSSO() {
  return env.usingSSO;
}
export function isSentryEnabled() {
  return !!env.sentryDSN;
}
