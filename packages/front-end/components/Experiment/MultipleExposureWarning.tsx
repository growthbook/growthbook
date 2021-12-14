// If this percent of users are in multiple variations, warn in the UI
const MULTIPLE_EXPOSURE_WARNING_THRESHOLD = 0.001;
const MULTIPLE_EXPOSURE_DANGER_THRESHOLD = 0.01;

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat();

export default function MultipleExposureWarning({
  users,
  multipleExposures,
}: {
  users: number[];
  multipleExposures: number;
}) {
  if (multipleExposures < 5) return null;
  const totalUsers = users.reduce((sum, n) => sum + n, 0);
  const percent = multipleExposures / (multipleExposures + totalUsers);

  if (percent < MULTIPLE_EXPOSURE_WARNING_THRESHOLD) {
    return null;
  }

  return (
    <div
      className={`alert alert-${
        percent < MULTIPLE_EXPOSURE_DANGER_THRESHOLD ? "warning" : "danger"
      }`}
    >
      <strong>Multiple Exposures Warning</strong>.{" "}
      {numberFormatter.format(multipleExposures)} users (
      {percentFormatter.format(percent)}) saw multiple variations and were
      automatically removed from results. Check for bugs in your implementation,
      event tracking, or data pipeline.
    </div>
  );
}
