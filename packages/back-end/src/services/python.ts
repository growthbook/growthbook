import { ChildProcess, spawn } from "child_process";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { CloudWatch } from "aws-sdk";
import { createPool } from "generic-pool";
import { MultipleExperimentMetricAnalysis } from "back-end/types/stats";
import { logger } from "back-end/src/util/logger";
import { ExperimentDataForStatsEngine } from "back-end/src/services/stats";
import { ENVIRONMENT, IS_CLOUD } from "back-end/src/util/secrets";
import { metrics } from "back-end/src/util/metrics";

type PythonServerResponse<T> = {
  id: string;
  time: number;
  results: T;
};

// The stats engine usually finishes within 1 second
// We use an overly conservative timeout to account for high load
const STATS_ENGINE_TIMEOUT_MS = 60_000;
const MAX_POOL_SIZE = 4;

let cloudWatch: CloudWatch | null = null;
if (IS_CLOUD) {
  cloudWatch = new CloudWatch();
}

class PythonStatsServer<Input, Output> {
  private python: ChildProcess;
  private pid = -1;
  private promises: Map<
    string,
    {
      resolve: (value: PythonServerResponse<Output>) => void;
      reject: (reason?: Error) => void;
    }
  >;

  constructor(script: string) {
    const [command, ...pythonArgs] = process.env.GB_ENABLE_PYTHON_DD_PROFILING
      ? ["ddtrace-run", "python3"]
      : ["python3"];

    this.python = spawn(command, [...pythonArgs, "-u", script], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.pid = this.python.pid || -1;
    logger.debug(`Python stats server (pid: ${this.pid}) started`);
    this.promises = new Map();

    let buffer = "";
    this.python.stdout?.on("data", (rawData) => {
      buffer += rawData.toString();

      // Once we have a complete line, process it
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep the last incomplete line in the buffer

      lines.forEach((line) => {
        const output = line.trim();
        if (!output) return; // Skip empty lines
        try {
          const parsed:
            | PythonServerResponse<Output>
            | { id: string; error: string; stack_trace?: string } = JSON.parse(
            output
          );

          if (!parsed.id) {
            logger.error(
              `Python stats server (pid: ${this.pid}) stdout missing 'id': ${parsed}`
            );
            return;
          }

          const promise = this.promises.get(parsed.id);
          if (!promise) {
            logger.warn(
              `Python stats server (pid: ${this.pid}) stdout has unknown id: ${parsed.id}`,
              parsed
            );
            return;
          }

          if ("error" in parsed) {
            // Add stack trace to error message so we can show it on the front-end
            const error = new Error(parsed.error || "Unknown error");
            if (parsed.stack_trace) {
              error.message += `\n\n${parsed.stack_trace}`;
            }
            promise.reject(error);
          } else {
            promise.resolve(parsed);
          }

          // Delete promise
          this.promises.delete(parsed.id);
        } catch (e) {
          logger.error(
            `Python stats server (pid: ${this.pid}) failed to parse stdout: ${output}`,
            e
          );
          return;
        }
      });
    });

    this.python.stderr?.on("data", (data) => {
      const err = data.toString().trim();
      // Ignore some common warnings in production
      if (ENVIRONMENT === "production") {
        // Pandas performance warnings
        if (err.match(/PerformanceWarning/)) return;
        // Runtime warnings from numpy
        if (err.match(/RuntimeWarning/)) return;
        // OpenTelemetry warnings from ddtrace
        if (err.match(/OTEL_/)) return;
      }

      logger.error(`Python stats server (pid: ${this.pid}) stderr: ${err}`);
    });

    // When the process dies
    this.python.on("close", (code, signal) => {
      logger.debug(
        `Python stats server (pid: ${this.pid}) exited with code ${code} ${signal}. Destroying server.`
      );
      this.destroy();
    });
  }

  destroy() {
    if (this.isRunning()) {
      this.python.kill();
    }
    this.promises.forEach((promise) =>
      promise.reject(new Error("Stats server killed"))
    );
    this.promises = new Map();
  }

  isRunning() {
    return this.python.exitCode === null;
  }

  async call(data: Input) {
    return new Promise<Output>((resolve, reject) => {
      const id = randomUUID();
      const start = Date.now();
      const cpus = os.cpus();

      // Timeout if the server doesn't respond within the defined timeout
      const timer = setTimeout(() => {
        logger.error(
          `Python stats server (pid: ${this.pid}) call timed out for id ${id}`
        );
        this.promises.delete(id);
        metrics.getCounter("python.stats_calls_rejected").increment();
        reject(new Error("Python stats server call timed out"));
      }, STATS_ENGINE_TIMEOUT_MS);

      this.promises.set(id, {
        resolve: ({ results, time }) => {
          logger.debug(
            `Python stats server (pid: ${this.pid}) Python time: ${time}`
          );
          logger.debug(
            `Python stats server (pid: ${this.pid}) Typescript time: ${
              (Date.now() - start) / 1000
            }`
          );
          logger.debug(
            `Python stats server (pid: ${
              this.pid
            }) Average CPU: ${JSON.stringify(getAvgCPU(cpus, os.cpus()))}`
          );
          clearTimeout(timer);

          metrics.getCounter("python.stats_calls_resolved").increment();
          metrics
            .getHistogram("python.stats_call_duration_ms")
            .record(Date.now() - start);

          resolve(results);
        },
        reject: (reason?: Error) => {
          logger.error(
            `Python stats server (pid: ${this.pid}) failed for id ${id}`,
            reason
          );
          clearTimeout(timer);

          metrics.getCounter("python.stats_calls_rejected").increment();
          metrics
            .getHistogram("python.stats_call_duration_ms")
            .record(Date.now() - start);

          reject(reason || new Error("Unknown error from Python stats server"));
        },
      });
      logger.debug(
        `Python stats server (pid: ${this.pid}) call started for id ${id}`
      );
      this.python.stdin?.write(JSON.stringify({ id, data }) + "\n");
    });
  }
}

export const statsServerPool = createPool(
  {
    create: async () => {
      return new PythonStatsServer<
        ExperimentDataForStatsEngine[],
        MultipleExperimentMetricAnalysis[]
      >(path.join(__dirname, "..", "..", "scripts", "stats_server.py"));
    },
    destroy: async (server) => server.destroy(),
    validate: async (server) => server.isRunning(),
  },
  {
    min: 1,
    max: MAX_POOL_SIZE,
    testOnBorrow: true,
    evictionRunIntervalMillis: 60000,
    numTestsPerEvictionRun: 2,
  }
);

function publishPoolSizeToCloudWatch(value: number) {
  if (!cloudWatch) return;
  try {
    cloudWatch.putMetricData({
      Namespace: "GrowthBook/PythonStatsPool",
      MetricData: [
        {
          MetricName: "PoolSize",
          Value: value,
          Unit: "Count",
        },
      ],
    });
  } catch (error) {
    // When not running on AWS, no need to publish to cloudwatch or warn us every minute.
    if (ENVIRONMENT === "production") {
      logger.error(
        "Failed to publish Python stats pool size to CloudWatch: " +
          error.message
      );
    }
  }
}

function monitorServicePool() {
  // If pool is exhausted it will emit this event
  statsServerPool.on("factoryCreateError", () => {
    metrics.getCounter("python.stats_pool_create_error").increment();
  });
  statsServerPool.on("factoryDestroyError", () => {
    metrics.getCounter("python.stats_pool_destroy_error").increment();
  });

  setInterval(() => {
    metrics.getGauge("python.stats_pool_size").record(statsServerPool.size);
    metrics
      .getGauge("python.stats_pool_idle")
      .record(statsServerPool.available);
    metrics.getGauge("python.stats_pool_busy").record(statsServerPool.borrowed);

    // Publish to CloudWatch in order to be able to scale the python service
    // Since generic-pool will only increase the pool size when all others are busy
    // and we only decrease it once a minute if left idle.  The size will show
    // the maximum pool size that was needed in the last minute.
    if (IS_CLOUD) {
      publishPoolSizeToCloudWatch(statsServerPool.size);
    }
  }, 60 * 1000);
}

if (!process.env.EXTERNAL_PYTHON_SERVER_URL) {
  monitorServicePool();
}

function getAvgCPU(pre: os.CpuInfo[], post: os.CpuInfo[]) {
  let user = 0;
  let system = 0;
  let total = 0;

  post.forEach((cpu, i) => {
    const preTimes = pre[i]?.times || { user: 0, sys: 0 };
    const postTimes = cpu.times;

    user += postTimes.user - preTimes.user;
    system += postTimes.sys - preTimes.sys;
    total +=
      Object.values(postTimes).reduce((sum, n) => sum + n, 0) -
      Object.values(preTimes).reduce((sum, n) => sum + n, 0);
  });

  return { user: user / total, system: system / total };
}
