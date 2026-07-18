import {
  workerExecArgv,
  workerEnv,
} from "../src/enterprise/sandbox/sandbox-pool";

// The sandbox worker is a forked child. It must NOT inherit the parent's tracing
// (APM) preload: a relative `--require .../tracing.*.js` fails to resolve from the
// worker and crash-loops the boot, and even when it resolves it re-bootstraps a
// full OpenTelemetry/Datadog SDK in every child. These tests pin that stripping.

const heapArg = (argv: string[]) =>
  argv.filter((a) => a.startsWith("--max-old-space-size="));

describe("workerExecArgv", () => {
  it("strips a separate-form tracing --require (OpenTelemetry)", () => {
    const argv = workerExecArgv([
      "--require",
      "./packages/back-end/dist/tracing.opentelemetry.js",
    ]);
    expect(argv).not.toContain("--require");
    expect(argv.some((a) => a.includes("tracing.opentelemetry"))).toBe(false);
  });

  it("strips a separate-form tracing -r (Datadog)", () => {
    const argv = workerExecArgv([
      "-r",
      "./packages/back-end/dist/tracing.datadog.js",
    ]);
    expect(argv).not.toContain("-r");
    expect(argv.some((a) => a.includes("tracing.datadog"))).toBe(false);
  });

  it("strips a combined-form tracing --require=<module>", () => {
    const argv = workerExecArgv(["--require=./dist/tracing.opentelemetry.js"]);
    expect(argv.some((a) => a.includes("tracing.opentelemetry"))).toBe(false);
  });

  it("keeps a non-tracing --require preload", () => {
    const argv = workerExecArgv(["--require", "ts-node/register"]);
    expect(argv).toEqual([
      "--require",
      "ts-node/register",
      expect.stringMatching(/^--max-old-space-size=\d+$/),
    ]);
  });

  it("keeps unrelated runtime flags", () => {
    const argv = workerExecArgv(["--enable-source-maps", "--no-node-snapshot"]);
    expect(argv).toContain("--enable-source-maps");
    expect(argv).toContain("--no-node-snapshot");
  });

  it("replaces the parent's heap cap with the worker's own", () => {
    const argv = workerExecArgv(["--max-old-space-size=8192"]);
    expect(argv).not.toContain("--max-old-space-size=8192");
    expect(heapArg(argv)).toHaveLength(1);
  });

  it("always appends exactly one heap cap, even with no parent flags", () => {
    expect(heapArg(workerExecArgv([]))).toHaveLength(1);
  });

  it("strips tracing while keeping a sibling preload and runtime flag", () => {
    const argv = workerExecArgv([
      "--enable-source-maps",
      "--require",
      "ts-node/register",
      "--require",
      "/opt/app/dist/tracing.opentelemetry.js",
    ]);
    expect(argv.some((a) => a.includes("tracing.opentelemetry"))).toBe(false);
    expect(argv).toContain("ts-node/register");
    expect(argv).toContain("--enable-source-maps");
    // The kept --require still pairs with its value (one require remains).
    expect(argv.filter((a) => a === "--require")).toHaveLength(1);
  });

  it("does not mutate the input array", () => {
    const input = ["--require", "./dist/tracing.opentelemetry.js"];
    workerExecArgv(input);
    expect(input).toEqual(["--require", "./dist/tracing.opentelemetry.js"]);
  });
});

describe("workerEnv", () => {
  it("hard-disables the tracing SDKs", () => {
    const env = workerEnv({});
    expect(env.OTEL_SDK_DISABLED).toBe("true");
    expect(env.DD_TRACE_ENABLED).toBe("false");
  });

  it("preserves unrelated env vars", () => {
    const env = workerEnv({ FOO: "bar", PATH: "/usr/bin" });
    expect(env.FOO).toBe("bar");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("scrubs a tracing --require from NODE_OPTIONS, keeping other options", () => {
    const env = workerEnv({
      NODE_OPTIONS:
        "--require ./dist/tracing.opentelemetry.js --max-http-header-size=16384",
    });
    expect(env.NODE_OPTIONS).toBe("--max-http-header-size=16384");
  });

  it("deletes NODE_OPTIONS when only the tracing require was present", () => {
    const env = workerEnv({
      NODE_OPTIONS: "--require ./dist/tracing.datadog.js",
    });
    expect("NODE_OPTIONS" in env).toBe(false);
  });

  it("scrubs the combined-form --require=<tracing> from NODE_OPTIONS", () => {
    const env = workerEnv({
      NODE_OPTIONS: "--require=/opt/app/dist/tracing.opentelemetry.js",
    });
    expect("NODE_OPTIONS" in env).toBe(false);
  });

  it("keeps a non-tracing NODE_OPTIONS require untouched", () => {
    const env = workerEnv({ NODE_OPTIONS: "--require ts-node/register" });
    expect(env.NODE_OPTIONS).toBe("--require ts-node/register");
  });

  it("does not mutate the input env object", () => {
    const input: NodeJS.ProcessEnv = {
      NODE_OPTIONS: "--require ./dist/tracing.opentelemetry.js",
    };
    workerEnv(input);
    expect(input.NODE_OPTIONS).toBe(
      "--require ./dist/tracing.opentelemetry.js",
    );
    expect("OTEL_SDK_DISABLED" in input).toBe(false);
  });
});
