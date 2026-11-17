import ExplorerPage from "@/enterprise/components/ProductAnalytics/ExplorerPage";

export default function FunnelExplorePage() {
  return <ExplorerPage type="funnel" breadcrumb={[{ display: "Funnels" }]} />;
}

FunnelExplorePage.noPageWrapper = true;
