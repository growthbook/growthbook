export function ConversionDelayHours({ form }) {
  return (
    <div className="form-group">
      <label>Conversion Delay (hours)</label>
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
        Ignore all conversions within the first X hours of being put into an
        experiment.
        {form.watch("windowSettings.window") === "conversion"
          ? " Will shift the start of the conversion window."
          : null}
      </small>
    </div>
  );
}
