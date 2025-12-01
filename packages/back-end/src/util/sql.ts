import { Worker } from "worker_threads";
import path from "path";
import Handlebars from "handlebars";
import { FormatDialect, FormatError } from "shared/src/types";
import { MAX_SQL_LENGTH_TO_FORMAT } from "shared/sql";
import { SQLVars } from "back-end/types/sql";
import {
  FactTableColumnType,
  JSONColumnFields,
} from "back-end/types/fact-table";
import { helpers } from "./handlebarsHelpers";

// Register all the helpers from handlebarsHelpers
Object.keys(helpers).forEach((helperName) => {
  Handlebars.registerHelper(helperName, helpers[helperName]);
});

export function getBaseIdTypeAndJoins(
  objects: string[][],
  forcedBaseIdType?: string,
) {
  // Get rid of empty ids, sort from least to most ids
  const sorted = objects
    .map((ids) => ids.filter(Boolean))
    .filter((ids) => ids.length > 0)
    .sort((a, b) => a.length - b.length);

  // Count how many objects use each id type
  const counts: Record<string, number> = {};
  objects.forEach((types) => {
    types.forEach((type) => {
      if (!type) return;
      counts[type] = counts[type] || 0;
      counts[type]++;
    });
  });

  const idTypesSortedByFrequency = Object.entries(counts).sort(
    (a, b) => b[1] - a[1],
  );

  // use most frequent ID as base type, unless forcedBaseIdType is passed
  const baseIdType = forcedBaseIdType || idTypesSortedByFrequency[0]?.[0] || "";

  const joinsRequired: Set<string> = new Set();
  sorted.forEach((types) => {
    // Object supports the base type already
    if (types.includes(baseIdType)) return;
    // Object supports one of the join types already
    if (types.filter((type) => joinsRequired.has(type)).length > 0) return;

    // Add id type that is most frequent to help minimize N joins needed
    joinsRequired.add(
      idTypesSortedByFrequency.find((x) => types.includes(x[0]))?.[0] ||
        types[0],
    );
  });

  return {
    baseIdType,
    joinsRequired: Array.from(joinsRequired),
  };
}

function usesTemplateVariable(sql: string, variableName: string) {
  return sql.match(new RegExp(`{{[^}]*${variableName}`, "g"));
}

// Compile sql template with handlebars, replacing vars (e.g. '{{startDate}}') and evaluating helpers (e.g. '{{camelcase eventName}}')
export function compileSqlTemplate(
  sql: string,
  {
    startDate,
    endDate,
    experimentId,
    templateVariables,
    customFields,
    phase,
  }: SQLVars,
) {
  // If there's no end date, use a near future date by default
  // We want to use at least 24 hours in the future in case of timezone issues
  // Set hours, minutes, seconds, ms to 0 so SQL can be more easily cached
  if (!endDate) {
    const now = new Date();
    endDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 2,
      0,
      0,
      0,
      0,
    );
  }

  // If we don't have an experimentId, fall back to using a percent sign
  // This way it can be used in a LIKE clause to match all experiment ids
  if (!experimentId) {
    experimentId = "%";
  }

  const replacements: Record<string, unknown> = {
    ...templateVariables,
    customFields: customFields || {},
    phase: phase || {},
    startDateUnix: "" + Math.floor(startDate.getTime() / 1000),
    startDateISO: startDate.toISOString(),
    startDate: startDate.toISOString().substr(0, 19).replace("T", " "),
    startYear: startDate.toISOString().substr(0, 4),
    startMonth: startDate.toISOString().substr(5, 2),
    startDay: startDate.toISOString().substr(8, 2),
    endDateUnix: "" + Math.floor(endDate.getTime() / 1000),
    endDateISO: endDate.toISOString(),
    endDate: endDate.toISOString().substr(0, 19).replace("T", " "),
    endYear: endDate.toISOString().substr(0, 4),
    endMonth: endDate.toISOString().substr(5, 2),
    endDay: endDate.toISOString().substr(8, 2),
    experimentId,
  };

  // Better error messages for known variables that are missing
  if (!templateVariables?.eventName && usesTemplateVariable(sql, "eventName")) {
    throw new Error(
      "Error compiling SQL template: You must set eventName first.",
    );
  }
  if (
    !templateVariables?.valueColumn &&
    usesTemplateVariable(sql, "valueColumn")
  ) {
    throw new Error(
      "Error compiling SQL template: You must set valueColumn first.",
    );
  }

  try {
    // TODO: Do sql escaping instead of html escaping for any new replacements
    const template = Handlebars.compile(sql, {
      strict: true,
      noEscape: true,
      knownHelpers: Object.keys(helpers).reduce(
        (acc, helperName) => {
          acc[helperName] = true;
          return acc;
        },
        {} as Record<string, true>,
      ),
      knownHelpersOnly: true,
    });
    return template(replacements);
  } catch (e) {
    if (e.message.includes("not defined in [object Object]")) {
      const variableName = e.message.match(/"(.+?)"/)[1];
      throw new Error(
        `Unknown variable: ${variableName}. Available variables: ${Object.keys(
          replacements,
        ).join(", ")}`,
      );
    }
    if (e.message.includes("unknown helper")) {
      const helperName = e.message.match(/unknown helper (\w*)/)[1];
      throw new Error(
        `Unknown helper: ${helperName}. Available helpers: ${Object.keys(
          helpers,
        ).join(", ")}`,
      );
    }
    throw new Error(`Error compiling SQL template: ${e.message}`);
  }
}

// used to support different server locations (e.g. for ClickHouse)
export function getHost(
  url: string | undefined,
  port: number,
): string | undefined {
  if (!url) return undefined;
  const host = new URL(!url.match(/^https?/) ? `http://${url}` : url);
  if (!host.port && port) host.port = port + "";
  return host.origin;
}

// Recursively create list of metric denominators in order
// For example, a "step3" metric has denominator "step2", which itself has denominator "step1"
// If you pass "step3" into this, it will return ["step1","step2","step3"]
export function expandDenominatorMetrics(
  metric: string,
  map: Map<string, { denominator?: string }>,
  visited?: Set<string>,
): string[] {
  visited = visited || new Set();
  const m = map.get(metric);
  if (!m) return [];
  if (visited.has(metric)) return [];

  visited.add(metric);
  if (!m.denominator) return [metric];
  return [...expandDenominatorMetrics(m.denominator, map, visited), metric];
}

// replace COUNT(*) with COUNT(${col}) to prevent counting null rows in some locations
export function replaceCountStar(aggregation: string, col: string) {
  return aggregation.replace(/count\(\s*\*\s*\)/gi, `COUNT(${col})`);
}

function isJSON(str: string) {
  // Only match objects
  if (!str?.startsWith("{")) return false;

  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

function getJSONFields(testValues: unknown[]): JSONColumnFields {
  const fields: JSONColumnFields = {};

  testValues.forEach((str) => {
    if (typeof str !== "string") return;
    try {
      const obj = JSON.parse(str);
      Object.keys(obj).forEach((key) => {
        if (fields[key]) return;
        if (obj[key] === null || obj[key] === undefined) return;
        if (Object.keys(fields).length > 50) return;

        fields[key] = {
          datatype:
            typeof obj[key] === "string"
              ? obj[key].match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}($|[ T])/)
                ? "date"
                : "string"
              : typeof obj[key] === "number"
                ? "number"
                : typeof obj[key] === "boolean"
                  ? "boolean"
                  : "other",
        };
      });
    } catch (e) {
      // Skip value
    }
  });

  return fields;
}

export function determineColumnTypes(
  rows: Record<string, unknown>[],
  typeMap: Map<string, FactTableColumnType>,
): {
  column: string;
  datatype: FactTableColumnType;
  jsonFields?: JSONColumnFields;
}[] {
  if (!rows || !rows[0]) return [];
  const cols = Object.keys(rows[0]);

  const columns: {
    column: string;
    datatype: FactTableColumnType;
    jsonFields?: JSONColumnFields;
  }[] = [];

  cols.forEach((col) => {
    const testValues = rows
      .map((row) => row[col])
      .filter((val) => val !== null && val !== undefined);
    const testValue = testValues[0];

    const colType = typeMap.get(col);
    const shouldAttemptInference =
      colType === undefined ||
      colType === "" ||
      (colType === "string" &&
        typeof testValue === "string" &&
        isJSON(testValue));

    if (!shouldAttemptInference) {
      return;
    } else if (typeof testValue === "string" && isJSON(testValue)) {
      // Use all test values to determine JSON fields
      columns.push({
        column: col,
        datatype: "json",
        jsonFields: getJSONFields(testValues),
      });
    } else if (testValue && testValue?.constructor === Object) {
      // Use all test values to determine JSON fields
      columns.push({
        column: col,
        datatype: "json",
        jsonFields: getJSONFields(testValues.map((v) => JSON.stringify(v))),
      });
    } else if (testValue !== undefined) {
      columns.push({
        column: col,
        datatype:
          typeof testValue === "string"
            ? testValue.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}($|[ T])/)
              ? "date"
              : "string"
            : typeof testValue === "number"
              ? "number"
              : typeof testValue === "boolean"
                ? "boolean"
                : testValue && testValue instanceof Date
                  ? "date"
                  : "other",
      });
    } else {
      columns.push({
        column: col,
        datatype: "",
      });
    }
  });

  return columns;
}
interface FormatMessage {
  sql: string;
  dialect?: FormatDialect;
}

interface FormatResult {
  formatted: string;
  error?: FormatError;
}

// Worker pool management
interface FormatWorkerPoolItem {
  worker: Worker;
  busy: boolean;
}

class FormatWorkerPool {
  private pool: FormatWorkerPoolItem[] = [];
  private readonly minSize: number =
    parseInt(process.env.FORMAT_WORKER_POOL_MIN_SIZE || "") || 0;
  private readonly maxSize: number =
    parseInt(process.env.FORMAT_WORKER_POOL_MIN_SIZE || "") || 2;
  private pendingTasks: Array<{
    message: FormatMessage;
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    onError?: (error: FormatError) => void;
  }> = [];

  constructor() {
    // Initialize with minimum pool size
    for (let i = 0; i < this.minSize; i++) {
      this.createWorker();
    }
  }

  private createWorker(): FormatWorkerPoolItem {
    const workerPath = path.join(
      __dirname,
      "..",
      "..",
      "scripts",
      "sql-format.worker.mjs",
    );
    const worker = new Worker(workerPath);
    const poolItem: FormatWorkerPoolItem = { worker, busy: false };

    worker.on("error", () => {
      // Remove this worker from the pool and create a new one
      const index = this.pool.indexOf(poolItem);
      if (index > -1) {
        this.pool.splice(index, 1);
      }
      worker.terminate();

      // Create a replacement worker if we're below min size
      if (this.pool.length < this.minSize) {
        this.createWorker();
      }
    });

    this.pool.push(poolItem);
    return poolItem;
  }

  private getAvailableWorker(): FormatWorkerPoolItem | null {
    // Try to find an idle worker
    const available = this.pool.find((item) => !item.busy);
    if (available) {
      return available;
    }

    // If no idle workers and we can grow the pool, create a new one
    if (this.pool.length < this.maxSize) {
      return this.createWorker();
    }

    return null;
  }

  private processNextTask(): void {
    if (this.pendingTasks.length === 0) return;

    const poolItem = this.getAvailableWorker();
    if (!poolItem) return;

    const task = this.pendingTasks.shift();
    if (!task) return;

    this.executeTask(poolItem, task);
  }

  private executeTask(
    poolItem: FormatWorkerPoolItem,
    task: {
      message: FormatMessage;
      resolve: (value: string) => void;
      reject: (error: Error) => void;
      onError?: (error: FormatError) => void;
    },
  ): void {
    poolItem.busy = true;

    const messageHandler = (result: FormatResult) => {
      poolItem.worker.off("message", messageHandler);
      poolItem.busy = false;

      if (result.error && task.onError) {
        task.onError(result.error);
      }

      task.resolve(result.formatted);

      // Process next pending task if any
      this.processNextTask();
    };

    poolItem.worker.on("message", messageHandler);
    poolItem.worker.postMessage(task.message);
  }

  public async format(
    sql: string,
    dialect?: FormatDialect,
    onError?: (error: FormatError) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const message: FormatMessage = { sql, dialect };
      const task = { message, resolve, reject, onError };

      const poolItem = this.getAvailableWorker();
      if (poolItem) {
        this.executeTask(poolItem, task);
      } else {
        // Queue the task if all workers are busy
        this.pendingTasks.push(task);
      }
    });
  }

  public async shutdown(): Promise<void> {
    if (this.pool.length === 0) return;
    await Promise.all(this.pool.map((item) => item.worker.terminate()));
    this.pool = [];
    this.pendingTasks = [];
  }
}

// Global worker pool instance
const workerPool = new FormatWorkerPool();

// Clean up worker pool on process exit and test completion
const cleanup = () => {
  workerPool.shutdown().catch(() => {
    /* ignore cleanup errors */
  });
};

process.on("beforeExit", cleanup);

/**
 * Shut down the worker pool. This should be called when the application exits
 * or in test cleanup (afterAll) to ensure worker threads are properly terminated.
 */
export async function shutdownFormatWorkerPool(): Promise<void> {
  await workerPool.shutdown();
}

/**
 * Format SQL asynchronously using a worker thread pool to avoid blocking the main thread.
 * This is useful for large queries as format is very CPU-intensive.
 * Workers are kept alive in a pool to eliminate worker creation overhead
 * and allow parallel processing when multiple format requests come in simultaneously.
 */
export async function formatAsync(
  sql: string,
  dialect?: FormatDialect,
  onError?: (error: FormatError) => void,
): Promise<string> {
  // Since format is not doing anything for big sql, no sense in passing it to the worker.
  if (MAX_SQL_LENGTH_TO_FORMAT && sql.length > MAX_SQL_LENGTH_TO_FORMAT) {
    return sql;
  }
  return workerPool.format(sql, dialect, onError);
}
