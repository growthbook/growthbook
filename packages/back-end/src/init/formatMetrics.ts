import { setFormatMetricsReporter } from "shared/sql";
import { metrics } from "back-end/src/util/metrics";

export function initFormatMetrics(): void {
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
