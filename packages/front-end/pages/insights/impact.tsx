import PageHead from "@/components/Layout/PageHead";
import ImpactPage from "@/enterprise/components/Insights/Impact/ImpactPage";

export default function InsightsImpactPage() {
  return (
    <>
      <PageHead breadcrumb={[{ display: "Insights" }, { display: "Impact" }]} />
      <ImpactPage />
    </>
  );
}
