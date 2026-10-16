import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

function getRepoRoot(): string {
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, "ecosystem.config.js")) &&
      fs.existsSync(path.join(dir, "scripts/run-apps.js"))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return path.resolve(__dirname, "../../..");
}

describe("Container Process Supervisor (scripts/run-apps.js) and ecosystem.config.js", () => {
  const repoRoot = getRepoRoot();
  const runAppsScript = path.join(repoRoot, "scripts/run-apps.js");
  const ecosystemConfig = path.join(repoRoot, "ecosystem.config.js");
  const req = createRequire(__filename);

  let testTempDir: string;

  beforeAll(() => {
    expect(fs.existsSync(runAppsScript)).toBe(true);
    expect(fs.existsSync(ecosystemConfig)).toBe(true);
  });

  beforeEach(() => {
    testTempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "growthbook-supervisor-test-"),
    );
  });

  afterEach(() => {
    if (fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    }
  });

  describe("Requirement 1: Direct stdio inheritance and zero filesystem log writes", () => {
    it("statically verifies that run-apps.js uses stdio: 'inherit' and contains no filesystem log writers", () => {
      const source = fs.readFileSync(runAppsScript, "utf8");

      // Spawns with stdio: 'inherit' directly
      expect(source).toMatch(/stdio:\s*["']inherit["']/);

      // Verifies zero filesystem write stream or append logic for logs
      expect(source).not.toContain("createWriteStream");
      expect(source).not.toContain("appendFileSync");
      expect(source).not.toContain("appendFile");

      // Verifies no log directory creation or PM2 log paths
      expect(source).not.toMatch(/\/tmp\/\.pm2/);
      expect(source).not.toMatch(/PM2_HOME.*logs/i);
    });

    it("verifies that executing run-apps.js with PM2_HOME set creates zero log files on disk", () => {
      const fakePm2Home = path.join(testTempDir, "fake-pm2-home");
      fs.mkdirSync(fakePm2Home, { recursive: true });

      // Create a dummy child script that emits both JSON log to stdout and a message to stderr
      const childScriptPath = path.join(testTempDir, "dummy-worker.js");
      fs.writeFileSync(
        childScriptPath,
        `
        console.log(JSON.stringify({ level: "info", msg: "app started", timestamp: Date.now() }));
        console.error("child stderr output");
        process.exit(0);
        `.trim(),
      );

      // Create a test ecosystem config referencing the dummy worker
      const testConfigPath = path.join(testTempDir, "ecosystem.test.config.js");
      fs.writeFileSync(
        testConfigPath,
        `
        module.exports = {
          apps: [
            {
              name: "worker",
              script: "${childScriptPath.replace(/\\/g, "\\\\")}",
              autorestart: false,
            },
          ],
        };
        `.trim(),
      );

      const result = spawnSync(
        process.execPath,
        [runAppsScript, "start", testConfigPath],
        {
          env: {
            ...process.env,
            PM2_HOME: fakePm2Home,
          },
          encoding: "utf8",
          timeout: 10000,
        },
      );

      // Child process stdout passed through directly via stdio: 'inherit'
      expect(result.stdout).toContain('"msg":"app started"');

      // Zero files or directories (such as logs/ or *.log) created in PM2_HOME (Issue #6644)
      const pm2Files = fs.readdirSync(fakePm2Home, { recursive: true });
      expect(pm2Files).toEqual([]);

      // Zero log files created anywhere in testTempDir (including nested subdirectories)
      const allTempFiles = (
        fs.readdirSync(testTempDir, { recursive: true }) as string[]
      ).map(String);
      const logFiles = allTempFiles.filter(
        (file) =>
          file.endsWith(".log") ||
          path.basename(file) === "logs" ||
          file.split(/[/\\]/).includes("logs"),
      );
      expect(logFiles).toEqual([]);
    });
  });

  describe("Requirement 2: Supervisor operational diagnostics sent strictly to stderr", () => {
    it("outputs usage instructions to stderr and keeps stdout empty when no config is provided", () => {
      const result = spawnSync(process.execPath, [runAppsScript], {
        encoding: "utf8",
        timeout: 10000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "usage: run-apps.js start <ecosystem.config.js> [--only <app>]",
      );
      expect(result.stdout).toBe("");
    });

    it("outputs operational diagnostics strictly to stderr preserving clean structured JSON on stdout", () => {
      const childScriptPath = path.join(testTempDir, "json-logger.js");
      const samplePayload = {
        level: "info",
        message: "user logged in",
        user_id: 12345,
      };

      fs.writeFileSync(
        childScriptPath,
        `
        console.log(JSON.stringify(${JSON.stringify(samplePayload)}));
        process.exit(0);
        `.trim(),
      );

      const testConfigPath = path.join(testTempDir, "ecosystem.test.config.js");
      fs.writeFileSync(
        testConfigPath,
        `
        module.exports = {
          apps: [
            {
              name: "json-app",
              script: "${childScriptPath.replace(/\\/g, "\\\\")}",
              autorestart: false,
            },
          ],
        };
        `.trim(),
      );

      const result = spawnSync(
        process.execPath,
        [runAppsScript, "start", testConfigPath],
        {
          encoding: "utf8",
          timeout: 10000,
        },
      );

      // stdout must contain exclusively the child's stdout line
      const stdoutLines = result.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      expect(stdoutLines).toHaveLength(1);
      expect(JSON.parse(stdoutLines[0])).toEqual(samplePayload);

      // stdout must NOT contain any supervisor [run-apps] diagnostic logs
      expect(result.stdout).not.toContain("[run-apps]");

      // stderr must contain all supervisor operational messages
      expect(result.stderr).toContain("[run-apps] started json-app");
      expect(result.stderr).toContain("[run-apps] json-app exited");
      expect(result.stderr).toContain("[run-apps] all apps stopped, exiting 2");
    });

    it("statically verifies that run-apps.js never writes diagnostics using console.log", () => {
      const source = fs.readFileSync(runAppsScript, "utf8");

      // Verify log helper targets console.error
      expect(source).toMatch(
        /const log = \(message\) => console\.error\(`\[run-apps\] \${message}`\);/,
      );

      // Verify console.log is never called anywhere in the supervisor
      expect(source).not.toMatch(/\bconsole\.log\(/);
    });
  });

  describe("Requirement 3: Supervisor accepts and parses ecosystem.config.js without writing disk logs", () => {
    it("correctly parses repository ecosystem.config.js definitions without disk log settings", () => {
      const config = req(ecosystemConfig);

      expect(config).toBeDefined();
      expect(Array.isArray(config.apps)).toBe(true);

      const appNames = config.apps.map((app: { name: string }) => app.name);
      expect(appNames).toContain("back-end");
      expect(appNames).toContain("front-end");

      // Confirm no PM2 disk log configurations are present (preventing disk filling regressions)
      for (const app of config.apps) {
        expect(app.out_file).toBeUndefined();
        expect(app.error_file).toBeUndefined();
        expect(app.log_file).toBeUndefined();
        expect(app.output).toBeUndefined();
        expect(app.error).toBeUndefined();
      }
    });

    it("exits with error on stderr and empty stdout when --only filter matches no applications", () => {
      const result = spawnSync(
        process.execPath,
        [runAppsScript, "start", ecosystemConfig, "--only", "non-existent-app"],
        {
          encoding: "utf8",
          timeout: 10000,
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("No apps to run in");
      expect(result.stderr).toContain("matching --only non-existent-app");
      expect(result.stdout).toBe("");
    });

    it("safely ignores and drops extraneous PM2 configuration keys with warning on stderr", () => {
      const childScriptPath = path.join(testTempDir, "worker.js");
      fs.writeFileSync(childScriptPath, `process.exit(0);`);

      const testConfigPath = path.join(
        testTempDir,
        "ecosystem.extra.config.js",
      );
      fs.writeFileSync(
        testConfigPath,
        `
        module.exports = {
          apps: [
            {
              name: "extra-props-app",
              script: "${childScriptPath.replace(/\\/g, "\\\\")}",
              autorestart: false,
              instances: 2,
              pmx: false,
              watch: false,
            },
          ],
        };
        `.trim(),
      );

      const result = spawnSync(
        process.execPath,
        [runAppsScript, "start", testConfigPath],
        {
          encoding: "utf8",
          timeout: 10000,
        },
      );

      // Dropped keys reported on stderr
      expect(result.stderr).toContain(
        "extra-props-app: instances=2 unsupported, starting one",
      );
      expect(result.stderr).toContain("extra-props-app: ignoring pmx, watch");
      // Clean stdout
      expect(result.stdout).toBe("");
    });
  });
});
