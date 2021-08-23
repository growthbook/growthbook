const env: {
  telemetry: "debug" | "enable" | "disable";
  cloud: boolean;
  apiHost: string;
  config: "file" | "db";
  defaultConversionWindowHours: number;
} = {
  telemetry: "enable",
  cloud: false,
  apiHost: "",
  config: "db",
  defaultConversionWindowHours: 72,
};

export async function initEnv() {
  const res = await fetch("/api/init");
  const json = await res.json();
  Object.assign(env, json);
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
