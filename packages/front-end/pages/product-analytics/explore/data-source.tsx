import ExplorerPage from "@/enterprise/components/ProductAnalytics/ExplorerPage";

export default function DataSourceExplorePage() {
  return (
    <ExplorerPage
      type="data_source"
      breadcrumb={[
        { display: "Explore", href: "/product-analytics/explore" },
        { display: "Data Source" },
      ]}
    />
  );
}

DataSourceExplorePage.noPageWrapper = true;
