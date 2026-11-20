import ExplorerPage from "@/enterprise/components/ProductAnalytics/ExplorerPage";

export default function FactTableExplorePage() {
  return (
    <ExplorerPage
      type="fact_table"
      breadcrumb={[
        { display: "Explore", href: "/product-analytics/explore" },
        { display: "Fact Table" },
      ]}
    />
  );
}

FactTableExplorePage.noPageWrapper = true;
