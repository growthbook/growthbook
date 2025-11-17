import { parentPort } from "worker_threads";
import { format } from "shared/sql";
import { FormatDialect, FormatError } from "shared/src/types";

interface FormatMessage {
  sql: string;
  dialect?: FormatDialect;
}

interface FormatResult {
  formatted: string;
  error?: FormatError;
}

if (!parentPort) {
  throw new Error("This file must be run as a worker thread");
}

parentPort.on("message", (message: FormatMessage) => {
  const result: FormatResult = {
    formatted: message.sql,
  };

  try {
    result.formatted = format(message.sql, message.dialect, (error) => {
      result.error = error;
    });
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    result.error = {
      error,
      originalSql: message.sql,
    };
  }

  parentPort!.postMessage(result);
});
