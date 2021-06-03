const env: {
  telemetry: "debug" | "enable" | "disable";
  cloud: boolean;
  apiHost: string;
} = {
  telemetry: "enable",
  cloud: false,
  apiHost: "",
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
