import ExplorerPage from "@/enterprise/components/ProductAnalytics/ExplorerPage";

export default function MetricsExplorePage() {
  return (
    <ExplorerPage
      type="metric"
      breadcrumb={[
        { display: "Explore", href: "/product-analytics/explore" },
        { display: "Metrics" },
      ]}
    />
  );
}

MetricsExplorePage.noPageWrapper = true;
