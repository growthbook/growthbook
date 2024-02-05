export function MetricDelayHours({ form }) {
  return (
    <div className="form-group">
      <label>Metric Delay (hours)</label>
      <input
        type="number"
        step="any"
        className="form-control"
        placeholder={"0"}
        {...form.register("windowSettings.delayHours", {
          valueAsNumber: true,
        })}
      />
      <small className="text-muted">
        Ignore all metric data within the first X hours of being put into an
        experiment.
        {form.watch("windowSettings.type") === "conversion"
          ? " Will shift the start of the conversion window."
          : null}
      </small>
    </div>
  );
}
