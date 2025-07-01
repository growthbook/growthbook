import { ChildProcess, spawn } from "child_process";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { createPool } from "generic-pool";
import { MultipleExperimentMetricAnalysis } from "back-end/types/stats";
import { logger } from "back-end/src/util/logger";
import { ExperimentDataForStatsEngine } from "back-end/src/services/stats";

type PythonServerResponse<T> = {
  id: string;
  time: number;
  results: T;
};

class PythonStatsServer<Input, Output> {
  private python: ChildProcess;
  private promises: Map<
    string,
    {
      resolve: (value: PythonServerResponse<Output>) => void;
      reject: (reason?: Error) => void;
    }
  >;

  constructor(script: string) {
    this.python = spawn("python3", ["-u", script], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    logger.info("Started Python stats server, pid " + this.python.pid);
    this.promises = new Map();

    this.python.stdout?.on("data", (data) => {
      const output = data.toString().trim();
      if (!output) return;

      try {
        const parsed:
          | PythonServerResponse<Output>
          | { id: string; error: string } = JSON.parse(output);

        if (!parsed.id) {
          logger.error("Python stats server output missing 'id':", parsed);
          return;
        }

        const promise = this.promises.get(parsed.id);
        if (!promise) {
          logger.error(
            `Python stats server returned result for unknown id: ${parsed.id}`,
            parsed
          );
          return;
        }

        if ("error" in parsed) {
          promise.reject(new Error(parsed.error || "Unknown error"));
        } else {
          promise.resolve(parsed);
        }

        // Delete promise
        this.promises.delete(parsed.id);
      } catch (e) {
        logger.error("Failed to parse Python stats server output:", e);
        return;
      }
    });

    this.python.stderr?.on("data", (data) => {
      logger.error("Python stats server stderr:", data.toString().trim());
    });

    // When the process dies
    this.python.on("close", (code, signal) => {
      logger.info(
        `Python stats server exited with code ${code} ${signal}. Destroying server.`
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

      // Timeout if the server doesn't respond within 20 seconds
      // It usually finishes in under 1 second, so this is overly conservative
      const timer = setTimeout(() => {
        logger.error(`StatsEngine: Python call timed out for id ${id}`);
        this.promises.delete(id);
        reject(new Error("Python stats server call timed out"));
      }, 20000);

      this.promises.set(id, {
        resolve: ({ results, time }) => {
          logger.debug(`StatsEngine: Python time: ${time}`);
          logger.debug(
            `StatsEngine: Typescript time: ${(Date.now() - start) / 1000}`
          );
          logger.debug(
            `StatsEngine: Average CPU: ${JSON.stringify(
              getAvgCPU(cpus, os.cpus())
            )}`
          );
          clearTimeout(timer);
          resolve(results);
        },
        reject: (reason?: Error) => {
          logger.error(`StatsEngine: Python call failed for id ${id}`, reason);
          clearTimeout(timer);
          reject(reason || new Error("Unknown error from Python stats server"));
        },
      });
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
    max: 10,
    testOnBorrow: true,
    evictionRunIntervalMillis: 60000,
    numTestsPerEvictionRun: 3,
  }
);

export function getAvgCPU(pre: os.CpuInfo[], post: os.CpuInfo[]) {
  let user = 0;
  let system = 0;
  let total = 0;

  post.forEach((cpu, i) => {
    const preTimes = pre[i]?.times || { user: 0, sys: 0 };
    const postTimes = cpu.times;

    user += postTimes.user - preTimes.user;
    system += postTimes.sys - preTimes.sys;
    total +=
      Object.values(postTimes).reduce((n, sum) => n + sum, 0) -
      Object.values(preTimes).reduce((n, sum) => n + sum, 0);
  });

  return { user: user / total, system: system / total };
}
