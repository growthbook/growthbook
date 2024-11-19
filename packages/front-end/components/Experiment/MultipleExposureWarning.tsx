import useOrgSettings from "@/hooks/useOrgSettings";

export const MINIMUM_MULTIPLE_EXPOSURES = 10;

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
  const settings = useOrgSettings();
  const MIN_PERCENT = settings?.multipleExposureMinPercent ?? 0.01;

  if (multipleExposures < MINIMUM_MULTIPLE_EXPOSURES) return null;
  const totalUsers = users.reduce((sum, n) => sum + n, 0);
  const percent = multipleExposures / (multipleExposures + totalUsers);

  if (percent < MIN_PERCENT) {
    return null;
  }

  return (
    <div className="alert alert-warning">
      <strong>多次曝光警告</strong>。{" "}
      {numberFormatter.format(multipleExposures)} 个用户（
      {percentFormatter.format(percent)}）看到了多个版本，并已自动从结果中移除。请检查您的实现、事件跟踪或数据管道中是否存在漏洞。
    </div>
  );
}
