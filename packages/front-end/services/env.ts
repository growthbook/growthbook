import * as Sentry from "@sentry/react";

const env: {
  telemetry: "debug" | "enable" | "disable";
  cloud: boolean;
  apiHost: string;
  config: "file" | "db";
  defaultConversionWindowHours: number;
  build?: {
    sha: string;
    date: string;
  };
  sentryDSN: string;
  apiCredentials: boolean;
} = {
  telemetry: "enable",
  cloud: false,
  apiHost: "",
  config: "db",
  defaultConversionWindowHours: 72,
  sentryDSN: "",
  apiCredentials: false,
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
export function includeApiCredentials() {
  return env.apiCredentials;
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
