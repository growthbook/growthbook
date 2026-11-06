import PageHead from "@/components/Layout/PageHead";
import HealthPage from "@/components/Insights/Health/HealthPage";

export default function InsightsHealthPage() {
  return (
    <>
      <PageHead breadcrumb={[{ display: "Insights" }, { display: "Health" }]} />
      <HealthPage />
    </>
  );
}
