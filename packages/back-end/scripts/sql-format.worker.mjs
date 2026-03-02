import { parentPort } from "worker_threads";
import { format as sqlFormat } from "sql-formatter";

if (!parentPort) {
  throw new Error("This file must be run as a worker thread");
}

export function format(sql, dialect, onError) {
  if (!dialect) return sql;

  try {
    return sqlFormat(sql, {
      language: dialect,
    });
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    if (onError) {
      onError({ error, originalSql: sql });
    }
    return sql;
  }
}

parentPort.on("message", (message) => {
  const result = {
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

  parentPort.postMessage(result);
});
