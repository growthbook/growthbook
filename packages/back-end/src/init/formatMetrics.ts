import {
  setFormatMetricsReporter,
  setPolyglotLoader,
  type PolyglotModule,
} from "shared/sql";
import { metrics } from "back-end/src/util/metrics";

export function initFormatMetrics(): void {
  // Use Function to preserve native import(); tsc/swc convert import() to require() which fails for ESM-only @polyglot-sql/sdk
  const dynamicImport = new Function("spec", "return import(spec)") as (
    spec: string,
  ) => Promise<PolyglotModule>;
  setPolyglotLoader(() => dynamicImport("@polyglot-sql/sdk"));
  const polyglotSuccess = metrics.getCounter("format.polyglot.success");
  const polyglotFailure = metrics.getCounter("format.polyglot.failure");
  const polyglotTime = metrics.getHistogram("format.polyglot.time");
  const sqlformatSuccess = metrics.getCounter("format.sqlformat.success");
  const sqlformatFailure = metrics.getCounter("format.sqlformat.failure");
  const sqlformatTime = metrics.getHistogram("format.sqlformat.time");

  setFormatMetricsReporter((event) => {
    if (event.engine === "polyglot") {
      if (event.success) {
        polyglotSuccess.increment();
      } else {
        polyglotFailure.increment();
      }
      polyglotTime.record(event.timeMs);
    } else {
      if (event.success) {
        sqlformatSuccess.increment();
      } else {
        sqlformatFailure.increment();
      }
      sqlformatTime.record(event.timeMs);
    }
  });
}
